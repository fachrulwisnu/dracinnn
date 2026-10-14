import React, { useState } from 'react';
import { X, Save, Edit3, Image, FileText, Layers, Film } from 'lucide-react';

interface EditDramaModalProps {
  drama: {
    provider?: string;
    dramaId: string;
    collection_id?: string;
    book_id?: string;
    title: string;
    synopsis?: string;
    coverUrl: string;
    categories: string[];
  };
  onClose: () => void;
  onSaveComplete: () => void;
}

export const EditDramaModal: React.FC<EditDramaModalProps> = ({
  drama,
  onClose,
  onSaveComplete,
}) => {
  const provider = drama.provider || 'pinedrama';
  const dramaId = drama.book_id || drama.collection_id || drama.dramaId;

  const [title, setTitle] = useState<string>(drama.title || '');
  const [synopsis, setSynopsis] = useState<string>(drama.synopsis || '');
  const [coverUrl, setCoverUrl] = useState<string>(drama.coverUrl || '');
  const [categoriesStr, setCategoriesStr] = useState<string>(drama.categories?.join(', ') || '');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setMessage(null);

    const categories = categoriesStr
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);

    try {
      const res = await fetch(`/api/dramas/${provider}/${dramaId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          synopsis,
          coverUrl,
          categories,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setMessage('✔ Drama berhasil diperbarui di MongoDB Atlas!');
        setTimeout(() => {
          onSaveComplete();
          onClose();
        }, 1000);
      } else {
        setMessage(`✖ Gagal menyimpan: ${data.error}`);
      }
    } catch (err: any) {
      setMessage(`✖ Error: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl relative p-6 space-y-6">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-full bg-slate-950 text-slate-400 hover:text-white transition-colors cursor-pointer border border-slate-800"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
          <div className="p-3 bg-amber-500/10 text-amber-400 rounded-2xl border border-amber-500/20">
            <Edit3 className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Edit Detail Drama</h2>
            <p className="text-xs text-slate-400">
              Provider: <span className="font-mono text-amber-300 font-bold uppercase">{provider}</span> · ID: {dramaId}
            </p>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-4 text-xs">
          <div>
            <label className="block text-slate-300 font-bold mb-1 flex items-center gap-1.5">
              <Film className="w-4 h-4 text-amber-400" />
              Judul Drama
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-3.5 py-2.5 font-bold focus:outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <label className="block text-slate-300 font-bold mb-1 flex items-center gap-1.5">
              <FileText className="w-4 h-4 text-amber-400" />
              Sinopsis / Deskripsi
            </label>
            <textarea
              rows={4}
              value={synopsis}
              onChange={(e) => setSynopsis(e.target.value)}
              placeholder="Tuliskan sinopsis atau abstrak drama di sini..."
              className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-3.5 py-2.5 font-medium focus:outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <label className="block text-slate-300 font-bold mb-1 flex items-center gap-1.5">
              <Image className="w-4 h-4 text-amber-400" />
              Cover Image URL
            </label>
            <input
              type="text"
              value={coverUrl}
              onChange={(e) => setCoverUrl(e.target.value)}
              placeholder="https://..."
              className="w-full bg-slate-950 border border-slate-800 text-white font-mono rounded-xl px-3.5 py-2.5 focus:outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <label className="block text-slate-300 font-bold mb-1 flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-amber-400" />
              Kategori / Tag (Dipisahkan Koma)
            </label>
            <input
              type="text"
              value={categoriesStr}
              onChange={(e) => setCategoriesStr(e.target.value)}
              placeholder="Romansa Urban, CEO, Balas Dendam"
              className="w-full bg-slate-950 border border-slate-800 text-white font-semibold rounded-xl px-3.5 py-2.5 focus:outline-none focus:border-amber-500"
            />
          </div>

          {message && (
            <div className={`p-3 rounded-xl text-xs font-semibold ${message.startsWith('✔') ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-rose-950 text-rose-300 border border-rose-800'}`}>
              {message}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-slate-800 text-slate-300 font-bold hover:bg-slate-700 transition-colors cursor-pointer"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-6 py-2.5 rounded-xl bg-amber-500 text-slate-950 font-black hover:bg-amber-400 transition-colors shadow-lg cursor-pointer flex items-center gap-2 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>{isSaving ? 'Menyimpan...' : 'Simpan Perubahan'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
