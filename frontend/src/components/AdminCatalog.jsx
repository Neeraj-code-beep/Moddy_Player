import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/api';

const initial = { title: '', artist: '', mood: 'calm', genre: '', energy: 'medium', tags: '' };
const REVIEW_FIELDS = ['mood', 'secondaryMoods', 'genre', 'subgenres', 'energy', 'listeningContexts', 'instrumentation', 'vocalCharacteristics', 'language', 'tags'];

export default function AdminCatalog() {
  const [queue, setQueue] = useState([]);
  const [analysisJobs, setAnalysisJobs] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(initial);
  const [file, setFile] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [response, jobs] = await Promise.all([api.get('/library/admin/songs?status=pending'), api.get('/library/admin/analysis/jobs?limit=100')]);
      setQueue(response.data.songs || []); setAnalysisJobs(jobs.data.jobs || []); setError('');
    }
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

  const reviewSuggestion = async (song, field, decision) => {
    setError('');
    try {
      await api.patch(`/library/admin/songs/${song._id}/metadata-review`, { fields: { [field]: decision } });
      setMessage(`AI ${field} suggestion ${decision}.`); await load();
    } catch { setError('The AI suggestion review could not be saved.'); }
  };

  const retryJob = async (job) => {
    setError('');
    try {
      await api.post(`/library/admin/analysis/jobs/${job.id}/retry`);
      setMessage('Analysis retry queued.'); await load();
    } catch { setError('Analysis job could not be retried. Check provider configuration and retry eligibility.'); }
  };

  return <section aria-labelledby="catalog-management-title" className="mt-8 rounded-2xl border border-amber-100/20 p-4 sm:p-6">
    <h3 id="catalog-management-title" className="text-xl font-medium text-white">Catalog management</h3>
    {message && <p role="status" className="mt-2 text-sm text-emerald-200">{message}</p>}{error && <p role="alert" className="mt-2 text-sm text-rose-200">{error}</p>}
    <p className="mt-2 text-sm text-white/50">If configured, uploaded audio is sent to the server-side Gemini provider for unverified semantic suggestions. Catalog songs remain pending until an administrator approves them.</p>
    <form onSubmit={upload} className="mt-4 grid gap-3 sm:grid-cols-2" aria-label="Upload a public catalog song">
      {['title', 'artist', 'mood', 'genre', 'energy', 'tags'].map((field) => <label key={field} className="grid gap-1 text-sm capitalize text-white/65">{field}<input required={['title', 'artist', 'mood'].includes(field)} value={form[field]} onChange={(event) => setForm({ ...form, [field]: event.target.value })} className="rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-white" /></label>)}
      <label className="grid gap-1 text-sm text-white/65 sm:col-span-2">Audio file<input required type="file" accept="audio/*" onChange={(event) => setFile(event.target.files?.[0] || null)} className="rounded-xl border border-white/15 p-2 text-white" /></label>
      <button disabled={busy} className="rounded-full bg-amber-100 px-5 py-3 font-semibold text-black disabled:opacity-50 sm:col-span-2">{busy ? 'Uploading…' : 'Submit catalog song for review'}</button>
    </form>
    <h4 className="mt-7 font-medium text-white">Pending review ({queue.length})</h4>
    <ul className="mt-3 space-y-3">{queue.map((song) => {
      const suggestions = song.analysis?.suggestions || {};
      return <li key={song._id} className="rounded-xl bg-white/5 p-3">
        {editingId === song._id ? <form onSubmit={(event) => void saveMetadata(event, song)} className="grid gap-2 sm:grid-cols-3">{['title', 'artist', 'mood', 'genre', 'energy', 'tags'].map((field) => <label key={field} className="grid gap-1 text-xs capitalize text-white/60">{field}<input name={field} defaultValue={Array.isArray(song[field]) ? song[field].join(',') : song[field] || ''} className="rounded-lg border border-white/15 bg-transparent px-3 py-2 text-sm text-white" /></label>)}<button className="rounded-full bg-amber-100 px-3 py-2 text-sm font-medium text-black">Save metadata</button><button type="button" onClick={() => setEditingId(null)} className="rounded-full border border-white/20 px-3 py-2 text-sm text-white">Cancel</button></form> : <>
          <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm text-white">{song.title} · {song.artist} · {song.mood}</span><span className="flex flex-wrap gap-2"><button onClick={() => setEditingId(song._id)} className="rounded-full border border-white/20 px-3 py-2 text-sm text-white">Edit</button><button onClick={() => void moderate(song, 'approved')} className="rounded-full bg-emerald-200 px-3 py-2 text-sm font-medium text-emerald-950">Approve</button><button onClick={() => void moderate(song, 'rejected')} className="rounded-full border border-rose-200/30 px-3 py-2 text-sm text-rose-100">Reject</button></span></div>
          <p className="mt-2 text-xs text-white/50" role="status">Analysis: {song.analysis?.status || 'not_configured'}</p>
          {song.analysis?.status === 'completed' && <div className="mt-3 grid gap-2 sm:grid-cols-2" aria-label={`AI suggestions for ${song.title}`}>
            {REVIEW_FIELDS.filter((field) => suggestions[field] !== undefined && suggestions[field] !== null).map((field) => {
              const value = Array.isArray(suggestions[field]) ? suggestions[field].join(', ') : suggestions[field];
              const review = suggestions.review?.[field];
              return <div key={field} className="rounded-lg border border-white/10 p-3"><p className="text-xs uppercase text-white/50">Suggested {field}</p><p className="mt-1 text-sm text-white">{value}</p><p className="mt-1 text-xs text-white/45">{review?.status || 'pending review'}</p>{(!review || review.status === 'pending') && <div className="mt-2 flex gap-2"><button onClick={() => void reviewSuggestion(song, field, 'accepted')} aria-label={`Accept suggested ${field}`} className="rounded-full bg-amber-100 px-3 py-1.5 text-xs font-semibold text-black">Accept</button><button onClick={() => void reviewSuggestion(song, field, 'rejected')} aria-label={`Reject suggested ${field}`} className="rounded-full border border-white/20 px-3 py-1.5 text-xs text-white">Reject</button></div>}</div>;
            })}
          </div>}
        </>}
      </li>;
    })}</ul>
    {!queue.length && <p className="mt-2 text-sm text-white/50">No catalog submissions need review.</p>}
    <section aria-labelledby="analysis-jobs-title" className="mt-8 border-t border-white/10 pt-5"><h4 id="analysis-jobs-title" className="font-medium text-white">AI analysis jobs ({analysisJobs.length})</h4>
      {!analysisJobs.length && <p className="mt-2 text-sm text-white/50">No analysis jobs are queued.</p>}
      <ul className="mt-3 space-y-2">{analysisJobs.map((job) => <li key={job.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/5 p-3 text-sm"><span className="text-white/80">{job.status} · attempt {job.attempts}/{job.maxAttempts}{job.lastErrorCode ? ` · ${job.lastErrorCode}` : ''}</span>{job.status === 'failed' && <button onClick={() => void retryJob(job)} className="rounded-full border border-amber-100/40 px-3 py-2 text-sm text-amber-50">Retry job</button>}</li>)}</ul>
    </section>
  </section>;
}
