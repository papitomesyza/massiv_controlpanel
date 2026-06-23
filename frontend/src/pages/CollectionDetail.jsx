import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, Library, FolderKanban } from 'lucide-react';
import { api } from '../api';

export default function CollectionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [collection, setCollection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    api.get('/collections')
      .then(data => {
        const found = data.find(c => String(c.id) === String(id));
        if (found) setCollection(found);
        else setNotFound(true);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return (
    <div style={{ padding: '24px' }}>
      <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
    </div>
  );

  if (notFound) return (
    <div style={{ padding: '24px' }}>
      <button className="btn-ghost" style={{ marginBottom: 16 }} onClick={() => navigate('/collections')}>
        <ChevronLeft size={16} style={{ marginRight: 4 }} /> Collections
      </button>
      <p style={{ color: 'var(--text-muted)' }}>Collection not found.</p>
    </div>
  );

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <button className="btn-ghost" style={{ padding: '6px 10px', fontSize: '13px', marginBottom: '16px' }} onClick={() => navigate('/collections')}>
          <ChevronLeft size={15} style={{ marginRight: 4 }} /> Collections
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(199,255,46,0.10)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Library size={20} color="var(--accent)" />
          </div>
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: 700, margin: 0 }}>{collection.name}</h1>
            {collection.project_id && collection.project_title && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                <FolderKanban size={12} color="var(--text-muted)" />
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{collection.project_title}</span>
              </div>
            )}
          </div>
        </div>
        {collection.description && (
          <p style={{ marginTop: '10px', color: 'var(--text-secondary)', fontSize: '13px' }}>{collection.description}</p>
        )}
      </div>

      <div className="card" style={{ padding: '48px 24px', textAlign: 'center' }}>
        <Library size={36} color="var(--text-muted)" style={{ margin: '0 auto 14px' }} />
        <p style={{ fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>No cards yet</p>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Cards (links and notes) will appear here in the next update.</p>
      </div>
    </div>
  );
}
