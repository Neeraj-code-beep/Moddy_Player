import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/api';
import AdminCatalog from './AdminCatalog';

const emptyForm = { title: '', artist: '', mood: 'calm', genre: '', energy: 'medium', tags: '' };
const ANALYSIS_FIELDS = ['mood', 'secondaryMoods', 'genre', 'subgenres', 'energy', 'listeningContexts', 'instrumentation', 'vocalCharacteristics', 'language', 'tags'];

function AnalysisReview({ song, onReview, onRetry }) {
  const analysis = song.analysis || {};
  const suggestions = song.aiSuggestions || {};
  const status = analysis.status || suggestions.status || 'not_configured';
  const label = { not_configured: 'Analysis not configured', queued: 'Waiting for analysis', processing: 'Analysis in progress', completed: 'Analysis complete', ready: 'Analysis available', failed: 'Analysis failed' }[status] || 'Analysis status unavailable';
  return <section className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3" aria-label={`Music analysis for ${song.title}`}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h5 className="font-medium text-white">Music analysis</h5><span role="status" className="text-sm text-white/60">{label}</span></div>
    {analysis.errorCode && <p role="alert" className="mt-2 text-sm text-rose-200">Analysis could not finish ({analysis.errorCode}).</p>}
    {status === 'failed' && <button type="button" onClick={() => void onRetry(song)} className="mt-3 rounded-full border border-amber-100/40 px-3 py-2 text-sm text-amber-50">Retry analysis</button>}
    {status === 'completed' && <dl className="mt-3 grid gap-3 sm:grid-cols-2">
      {ANALYSIS_FIELDS.filter((field) => suggestions[field] !== undefined && suggestions[field] !== null).map((field) => {
        const value = Array.isArray(suggestions[field]) ? suggestions[field].join(', ') : suggestions[field];
        const review = suggestions.review?.[field];
        return <div key={field} className="rounded-lg bg-white/5 p-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-white/50">{field.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}</dt>
          <dd className="mt-1 text-sm text-white">{value}</dd>
          <dd className="mt-2 text-xs text-white/50">{review?.status ? `Review: ${review.status}` : 'AI suggestion · pending review'}</dd>
          {(!review || review.status === 'pending') && <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => void onReview(song, field, 'accepted')} aria-label={`Accept suggested ${field}`} className="rounded-full bg-amber-100 px-3 py-1.5 text-xs font-semibold text-black">Accept</button>
            <button type="button" onClick={() => void onReview(song, field, 'rejected')} aria-label={`Reject suggested ${field}`} className="rounded-full border border-white/20 px-3 py-1.5 text-xs text-white">Reject</button>
          </div>}
        </div>;
      })}
    </dl>}
    {status === 'completed' && !ANALYSIS_FIELDS.some((field) => suggestions[field] !== undefined && suggestions[field] !== null) && <p className="mt-2 text-sm text-white/50">No supported suggestions were returned.</p>}
  </section>;
}

export default function MusicLibrary({ user, onPlaySong }) {
  const [songs, setSongs] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [playlistDetail, setPlaylistDetail] = useState(null);
  const [activePlaylistId, setActivePlaylistId] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [audio, setAudio] = useState(null);
  const [playlistName, setPlaylistName] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [moodDraft, setMoodDraft] = useState('');
  const [filters, setFilters] = useState({ q: '', mood: '' });
  const [editingId, setEditingId] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const reviewAnalysis = async (song, field, decision) => {
    setError('');
    try {
      await api.patch(`/library/songs/${song._id}/metadata-review`, { fields: { [field]: decision } });
      setMessage(`Suggestion ${decision}.`);
      await load();
    } catch { setError('The suggestion review could not be saved.'); }
  };

  const retryAnalysis = async (song) => {
    setError('');
    try {
      await api.post(`/library/songs/${song._id}/analysis/retry`);
      setMessage('Analysis retry queued.');
      await load();
    } catch { setError('Analysis could not be retried. Check that the music analysis service is configured.'); }
  };

  const load = useCallback(async () => {
    if (!user) return;
    setError('');
    try {
      const [library, saved, lists] = await Promise.all([
        api.get('/library/songs', { params: { ...filters, page: 1, limit: 100 } }), api.get('/library/favorites'), api.get('/library/playlists'),
      ]);
      setSongs(library.data.songs || []);
      setFavorites(saved.data.favorites || []);
      setPlaylists(lists.data.playlists || []);
    } catch {
      setError('Your music could not be loaded. Please try again.');
    }
  }, [user, filters]);

  useEffect(() => { void load(); }, [load]);

  const upload = async (event) => {
    event.preventDefault();
    if (!audio) return setError('Choose an audio file first.');
    setBusy(true); setError(''); setMessage('');
    try {
      const data = new FormData();
      Object.entries(form).forEach(([key, value]) => data.append(key, value));
      data.append('audio', audio);
      await api.post('/library/songs', data);
      setForm(emptyForm); setAudio(null);
      event.target.reset();
      setMessage('Song added to your private library.');
      await load();
    } catch {
      setError('The song could not be uploaded. Check its details and try again.');
    } finally { setBusy(false); }
  };

  const saveSong = async (event, song) => {
    event.preventDefault(); setBusy(true); setError('');
    const formData = new FormData(event.currentTarget);
    const values = Object.fromEntries(formData.entries());
    const aiSuggestions = {
      mood: values.suggestionMood,
      genre: values.suggestionGenre,
      energy: values.suggestionEnergy,
      tags: values.suggestionTags ? values.suggestionTags.split(',').map((tag) => tag.trim()).filter(Boolean) : undefined,
      language: values.suggestionLanguage,
    };
    for (const field of ['suggestionMood', 'suggestionGenre', 'suggestionEnergy', 'suggestionTags', 'suggestionLanguage']) delete values[field];
    Object.keys(aiSuggestions).forEach((key) => { if (!aiSuggestions[key]) delete aiSuggestions[key]; });
    try {
      await api.patch(`/library/songs/${song._id}`, { ...values, ...(Object.keys(aiSuggestions).length ? { aiSuggestions } : {}) });
      setEditingId(null); setMessage('Song details updated.'); await load();
    } catch { setError('Song details could not be saved.'); } finally { setBusy(false); }
  };

  const removeSong = async (song) => {
    setBusy(true); setError('');
    try { await api.delete(`/library/songs/${song._id}`); setMessage('Song and its stored media were deleted.'); await load(); }
    catch { setError('Song deletion did not finish. You can retry safely.'); } finally { setBusy(false); }
  };

  const toggleFavorite = async (song) => {
    setError('');
    try {
      const saved = favorites.some((item) => item._id === song._id);
      if (saved) await api.delete(`/library/favorites/${song._id}`);
      else await api.post(`/library/favorites/${song._id}`);
      await load();
    } catch { setError('Favorite could not be updated. Please retry.'); }
  };

  const createPlaylist = async (event) => {
    event.preventDefault(); setError('');
    try { await api.post('/library/playlists', { name: playlistName }); setPlaylistName(''); await load(); }
    catch { setError('Playlist could not be created.'); }
  };

  const addToPlaylist = async (song) => {
    if (!activePlaylistId) return setError('Choose a playlist first.');
    try {
      const response = await api.get(`/library/playlists/${activePlaylistId}`);
      const current = response.data.playlist;
      await api.patch(`/library/playlists/${activePlaylistId}`, {
        revision: current.revision,
        songIds: [...current.songs.map((item) => item._id), song._id],
      });
      setMessage(`Added to ${playlists.find((item) => item.id === activePlaylistId)?.name}.`);
      const updated = await api.get(`/library/playlists/${activePlaylistId}`);
      setPlaylistDetail(updated.data.playlist);
      await load();
    } catch { setError('Playlist changed or the song is no longer available. Reload and retry.'); }
  };

  const openPlaylist = async (playlist) => {
    try {
      const response = await api.get(`/library/playlists/${playlist.id}`);
      setPlaylistDetail(response.data.playlist);
      setActivePlaylistId(playlist.id);
    } catch { setError('Playlist could not be opened.'); }
  };

  const updatePlaylistSongs = async (songIds) => {
    if (!playlistDetail) return;
    try {
      const response = await api.patch(`/library/playlists/${playlistDetail.id}`, { revision: playlistDetail.revision, songIds });
      await openPlaylist({ id: response.data.playlist.id });
      await load();
    } catch { setError('Playlist changed or one of its songs is no longer available. Refresh and retry.'); }
  };

  const renamePlaylist = async (playlist) => {
    const name = window.prompt('Rename playlist', playlist.name);
    if (name === null || !name.trim()) return;
    try {
      const response = await api.get(`/library/playlists/${playlist.id}`);
      await api.patch(`/library/playlists/${playlist.id}`, { name, revision: response.data.playlist.revision });
      setMessage('Playlist renamed.'); await load();
      if (playlistDetail?.id === playlist.id) await openPlaylist({ id: playlist.id });
    } catch { setError('Playlist could not be renamed.'); }
  };

  const deletePlaylist = async (playlist) => {
    try { await api.delete(`/library/playlists/${playlist.id}`); if (playlistDetail?.id === playlist.id) setPlaylistDetail(null); await load(); }
    catch { setError('Playlist could not be deleted.'); }
  };

  if (!user) return null;

  return (
    <section id="library" aria-labelledby="library-title" className="mx-auto w-full max-w-6xl scroll-mt-24 px-5 py-12 sm:px-8">
      <div className="rounded-3xl border border-white/10 bg-[#181816] p-5 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-100/70">Your music</p>
        <h2 id="library-title" className="mt-2 text-3xl font-semibold text-white">My Library</h2>
        <p className="mt-2 max-w-2xl text-sm text-white/60">Uploads stay private to your account. Add, edit, play, favorite, and organize your tracks here.</p>
        <p className="mt-2 max-w-2xl text-xs text-white/45">When server-side music analysis is configured, uploaded audio is sent to the configured Gemini provider for semantic suggestions. Suggestions remain unverified until you review them.</p>
        {message && <p role="status" className="mt-4 text-sm text-emerald-200">{message}</p>}
        {error && <p role="alert" className="mt-4 text-sm text-rose-200">{error}</p>}

        <form onSubmit={upload} className="mt-7 grid gap-3 rounded-2xl border border-white/10 p-4 sm:grid-cols-2" aria-label="Upload a private song">
          <h3 className="sm:col-span-2 text-lg font-medium text-white">Upload a song</h3>
          {['title', 'artist', 'mood', 'genre', 'energy', 'tags'].map((field) => (
            <label key={field} className="grid gap-1 text-sm capitalize text-white/70">{field}
              <input required={['title', 'artist', 'mood'].includes(field)} value={form[field]} onChange={(event) => setForm({ ...form, [field]: event.target.value })} className="rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-white outline-none focus:border-amber-100" />
            </label>
          ))}
          <label className="grid gap-1 text-sm text-white/70 sm:col-span-2">Audio file
            <input required type="file" accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a,.aac,.opus,.webm" onChange={(event) => setAudio(event.target.files?.[0] || null)} className="rounded-xl border border-white/15 p-2 text-white" />
          </label>
          <button disabled={busy} className="rounded-full bg-amber-100 px-5 py-3 font-semibold text-[#201b13] disabled:opacity-50 sm:col-span-2">{busy ? 'Saving…' : 'Add to private library'}</button>
        </form>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-xl font-medium text-white">Your songs <span className="text-sm text-white/50">({songs.length})</span></h3>
          <button type="button" onClick={() => void load()} className="rounded-full border border-white/20 px-4 py-2 text-sm text-white">Refresh library</button>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); setFilters({ q: searchDraft.trim(), mood: moodDraft }); }} className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]" aria-label="Search your library">
          <label className="sr-only" htmlFor="library-search">Search title or artist</label><input id="library-search" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search title or artist" className="rounded-xl border border-white/15 bg-transparent px-3 py-2 text-sm text-white" />
          <label className="sr-only" htmlFor="library-mood">Filter by mood</label><input id="library-mood" value={moodDraft} onChange={(event) => setMoodDraft(event.target.value)} placeholder="Mood" className="rounded-xl border border-white/15 bg-transparent px-3 py-2 text-sm text-white" />
          <button className="rounded-full border border-white/20 px-4 py-2 text-sm text-white">Search and filter</button>
        </form>
        <div className="mt-4 grid gap-3">
          {songs.map((song) => (
            <article key={song._id} className="rounded-2xl border border-white/10 bg-black/15 p-4">
              {editingId === song._id ? <form onSubmit={(event) => void saveSong(event, song)} className="grid gap-2 sm:grid-cols-3">
                {['title', 'artist', 'mood', 'genre', 'energy', 'tags'].map((field) => <label key={field} className="grid gap-1 text-xs capitalize text-white/60">{field}<input name={field} defaultValue={Array.isArray(song[field]) ? song[field].join(',') : song[field] || ''} className="rounded-lg border border-white/15 bg-transparent px-3 py-2 text-sm text-white" /></label>)}
                <p className="sm:col-span-3 mt-2 text-xs font-semibold uppercase tracking-wide text-white/50">Owner-edited categorization suggestions</p>
                {['mood', 'genre', 'energy', 'tags', 'language'].map((field) => <label key={`suggestion-${field}`} className="grid gap-1 text-xs capitalize text-white/60">Suggested {field}<input name={`suggestion${field[0].toUpperCase()}${field.slice(1)}`} defaultValue={Array.isArray(song.aiSuggestions?.[field]) ? song.aiSuggestions[field].join(',') : song.aiSuggestions?.[field] || ''} className="rounded-lg border border-white/15 bg-transparent px-3 py-2 text-sm text-white" /></label>)}
                <button disabled={busy} className="rounded-full bg-amber-100 px-4 py-2 text-sm font-semibold text-black">Save changes</button>
                <button type="button" onClick={() => setEditingId(null)} className="rounded-full border border-white/20 px-4 py-2 text-sm text-white">Cancel</button>
              </form> : <><div className="flex flex-wrap items-center justify-between gap-3">
                <div><h4 className="font-medium text-white">{song.title}</h4><p className="text-sm text-white/60">{song.artist} · {song.mood} · Private · {song.mediaStatus === 'deletion_failed' ? 'Media cleanup needs a retry' : song.aiSuggestions?.status || 'AI categorization not configured'}</p></div>
                <div className="flex flex-wrap gap-2">
                  <button disabled={song.mediaStatus !== 'active'} onClick={() => onPlaySong(song)} className="rounded-full bg-white/10 px-4 py-2 text-sm text-white disabled:opacity-40">Play</button>
                  {song.mediaStatus === 'active' && <button onClick={() => void toggleFavorite(song)} className="rounded-full border border-white/20 px-4 py-2 text-sm text-white">{favorites.some((item) => item._id === song._id) ? 'Unfavorite' : 'Favorite'}</button>}
                  {song.mediaStatus === 'active' && <button onClick={() => setEditingId(song._id)} className="rounded-full border border-white/20 px-4 py-2 text-sm text-white">Edit</button>}
                  <button onClick={() => void removeSong(song)} className="rounded-full border border-rose-200/30 px-4 py-2 text-sm text-rose-100">{song.mediaStatus === 'deletion_failed' ? 'Retry media cleanup' : 'Delete'}</button>
                  {song.mediaStatus === 'active' && playlists.length > 0 && <><label className="sr-only" htmlFor={`playlist-for-${song._id}`}>Choose a playlist</label><select id={`playlist-for-${song._id}`} value={activePlaylistId} onChange={(event) => setActivePlaylistId(event.target.value)} className="max-w-36 rounded-full border border-white/20 bg-[#181816] px-3 py-2 text-sm text-white"><option value="">Playlist…</option>{playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.name}</option>)}</select><button onClick={() => void addToPlaylist(song)} className="rounded-full border border-white/20 px-4 py-2 text-sm text-white">Add</button></>}
                </div>
              </div><AnalysisReview song={song} onReview={reviewAnalysis} onRetry={retryAnalysis} /></>}
            </article>
          ))}
          {!songs.length && <p className="rounded-2xl border border-dashed border-white/15 p-6 text-sm text-white/60">Your library is empty. Upload a song to get started.</p>}
        </div>

        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <section aria-labelledby="favorites-title"><h3 id="favorites-title" className="text-lg font-medium text-white">Favorites</h3><ul className="mt-3 space-y-2">{favorites.map((song) => <li key={song._id} className="flex justify-between gap-3 rounded-xl bg-white/5 p-3 text-sm text-white"><span>{song.title} · {song.artist}</span><button onClick={() => onPlaySong(song)} aria-label={`Play ${song.title}`}>Play</button></li>)}</ul>{!favorites.length && <p className="mt-2 text-sm text-white/50">Favorite songs to find them here.</p>}</section>
          <section aria-labelledby="playlists-title"><h3 id="playlists-title" className="text-lg font-medium text-white">Playlists</h3><form onSubmit={(event) => void createPlaylist(event)} className="mt-3 flex gap-2"><label className="sr-only" htmlFor="playlist-name">Playlist name</label><input id="playlist-name" required maxLength={80} value={playlistName} onChange={(event) => setPlaylistName(event.target.value)} placeholder="New playlist" className="min-w-0 flex-1 rounded-xl border border-white/15 bg-transparent px-3 py-2 text-white" /><button className="rounded-full bg-amber-100 px-4 py-2 text-sm font-semibold text-black">Create</button></form><ul className="mt-3 space-y-2">{playlists.map((playlist) => <li key={playlist.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/5 p-3 text-sm text-white"><span>{playlist.name} · {playlist.songCount} songs</span><span className="flex gap-2"><button onClick={() => void openPlaylist(playlist)} className="rounded-full border border-white/20 px-3 py-1">Open</button><button onClick={() => void renamePlaylist(playlist)} className="rounded-full border border-white/20 px-3 py-1">Rename</button><button onClick={() => void deletePlaylist(playlist)} className="rounded-full border border-rose-200/30 px-3 py-1 text-rose-100">Delete</button></span></li>)}</ul>
            {playlistDetail && <div className="mt-4 rounded-xl border border-white/10 p-3"><div className="flex items-center justify-between"><h4 className="font-medium text-white">{playlistDetail.name}</h4><button onClick={() => setPlaylistDetail(null)} aria-label="Close playlist details" className="text-white/70">Close</button></div><ol className="mt-2 space-y-2">{playlistDetail.songs.map((song, index) => <li key={song._id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-white"><span>{index + 1}. {song.title} · {song.artist}</span><span className="flex gap-2"><button onClick={() => onPlaySong(song)} aria-label={`Play ${song.title}`}>Play</button><button disabled={index === 0} onClick={() => { const ids = playlistDetail.songs.map((item) => item._id); [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]]; void updatePlaylistSongs(ids); }} aria-label={`Move ${song.title} up`}>↑</button><button disabled={index === playlistDetail.songs.length - 1} onClick={() => { const ids = playlistDetail.songs.map((item) => item._id); [ids[index + 1], ids[index]] = [ids[index], ids[index + 1]]; void updatePlaylistSongs(ids); }} aria-label={`Move ${song.title} down`}>↓</button><button onClick={() => void updatePlaylistSongs(playlistDetail.songs.filter((item) => item._id !== song._id).map((item) => item._id))}>Remove</button></span></li>)}</ol></div>}
          </section>
        </div>
        {user.role === 'admin' && <AdminCatalog />}
      </div>
    </section>
  );
}
