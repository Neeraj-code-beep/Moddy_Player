import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/api';

const initial = { title: '', artist: '', mood: 'calm', genre: '', energy: 'medium', tags: '' };

export default function AdminCatalog() {
  const [queue, setQueue] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(initial);
  const [file, setFile] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const response = await api.get('/library/admin/songs?status=pending'); setQueue(response.data.songs || []); setError(''); }
    catch { setError('The catalog review queue could not be loaded.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const upload = async (event) => {
    event.preventDefault();
    if (!file) return setError('Choose an audio file first.');
    setBusy(true); setError(''); setMessage('');
    try {
      const data = new FormData();
      Object.entries(form).forEach(([key, value]) => data.append(key, value));
      data.append('audio', file);
      await api.post('/songs', data);
      setForm(initial); setFile(null); event.target.reset();
      setMessage('Catalog upload submitted for review.'); await load();
    } catch { setError('Catalog upload failed. Check the file and metadata.'); }
    finally { setBusy(false); }
  };

  const moderate = async (song, status) => {
    setError('');
    try { await api.patch(`/library/admin/songs/${song._id}`, { status }); setMessage(`Song ${status}.`); await load(); }
    catch { setError('The catalog status could not be updated.'); }
  };

  const saveMetadata = async (event, song) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setError('');
    try {
      await api.patch(`/library/admin/songs/${song._id}`, { metadata: Object.fromEntries(values.entries()) });
      setEditingId(null); setMessage('Catalog metadata updated.'); await load();
    } catch { setError('Catalog metadata could not be saved.'); }
  };

  return <section aria-labelledby="catalog-management-title" className="mt-8 rounded-2xl border border-amber-100/20 p-4 sm:p-6">
    <h3 id="catalog-management-title" className="text-xl font-medium text-white">Catalog management</h3>
    {message && <p role="status" className="mt-2 text-sm text-emerald-200">{message}</p>}{error && <p role="alert" className="mt-2 text-sm text-rose-200">{error}</p>}
    <form onSubmit={upload} className="mt-4 grid gap-3 sm:grid-cols-2" aria-label="Upload a public catalog song">
      {['title', 'artist', 'mood', 'genre', 'energy', 'tags'].map((field) => <label key={field} className="grid gap-1 text-sm capitalize text-white/65">{field}<input required={['title', 'artist', 'mood'].includes(field)} value={form[field]} onChange={(event) => setForm({ ...form, [field]: event.target.value })} className="rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-white" /></label>)}
      <label className="grid gap-1 text-sm text-white/65 sm:col-span-2">Audio file<input required type="file" accept="audio/*" onChange={(event) => setFile(event.target.files?.[0] || null)} className="rounded-xl border border-white/15 p-2 text-white" /></label>
      <button disabled={busy} className="rounded-full bg-amber-100 px-5 py-3 font-semibold text-black disabled:opacity-50 sm:col-span-2">{busy ? 'Uploading…' : 'Submit catalog song for review'}</button>
    </form>
    <h4 className="mt-7 font-medium text-white">Pending review ({queue.length})</h4>
    <ul className="mt-3 space-y-3">{queue.map((song) => <li key={song._id} className="rounded-xl bg-white/5 p-3">{editingId === song._id ? <form onSubmit={(event) => void saveMetadata(event, song)} className="grid gap-2 sm:grid-cols-3">{['title', 'artist', 'mood', 'genre', 'energy', 'tags'].map((field) => <label key={field} className="grid gap-1 text-xs capitalize text-white/60">{field}<input name={field} defaultValue={Array.isArray(song[field]) ? song[field].join(',') : song[field] || ''} className="rounded-lg border border-white/15 bg-transparent px-3 py-2 text-sm text-white" /></label>)}<button className="rounded-full bg-amber-100 px-3 py-2 text-sm font-medium text-black">Save metadata</button><button type="button" onClick={() => setEditingId(null)} className="rounded-full border border-white/20 px-3 py-2 text-sm text-white">Cancel</button></form> : <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm text-white">{song.title} · {song.artist} · {song.mood}</span><span className="flex gap-2"><button onClick={() => setEditingId(song._id)} className="rounded-full border border-white/20 px-3 py-2 text-sm text-white">Edit</button><button onClick={() => void moderate(song, 'approved')} className="rounded-full bg-emerald-200 px-3 py-2 text-sm font-medium text-emerald-950">Approve</button><button onClick={() => void moderate(song, 'rejected')} className="rounded-full border border-rose-200/30 px-3 py-2 text-sm text-rose-100">Reject</button></span></div>}</li>)}</ul>
    {!queue.length && <p className="mt-2 text-sm text-white/50">No catalog submissions need review.</p>}
  </section>;
}
