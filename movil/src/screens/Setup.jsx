import { useState } from 'react';
import Logo from '../components/Logo.jsx';

// Conexión con la nube. El endpoint y el bucket vienen escritos; solo faltan las claves.
export default function Setup({ initial, onSave, onCancel, busy, error }) {
  const [endpoint, setEndpoint] = useState(initial?.endpoint || '');
  const [bucket, setBucket] = useState(initial?.bucket || '');
  const [accessKeyId, setKey] = useState(initial?.accessKeyId || '');
  const [secretAccessKey, setSecret] = useState('');

  const submit = (e) => {
    e.preventDefault();
    onSave({ endpoint, bucket, accessKeyId, secretAccessKey: secretAccessKey || initial?.secretAccessKey || '' });
  };

  return (
    <div className="setup">
      <Logo large />
      <div className="maker">SOLIDPIXEL · MÓVIL</div>
      <form className="card" onSubmit={submit}>
        <h3>☁ Conectar tu música</h3>
        <p className="hint">Usa una clave de <b>solo lectura</b> de Cloudflare R2. Se guarda solo en este teléfono.</p>
        <label>Endpoint
          <input value={endpoint} placeholder="https://TU-ID.r2.cloudflarestorage.com" onChange={(e) => setEndpoint(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck="false" />
        </label>
        <label>Bucket
          <input value={bucket} placeholder="mi-musica" onChange={(e) => setBucket(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck="false" />
        </label>
        <label>Access Key ID
          <input value={accessKeyId} onChange={(e) => setKey(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck="false" />
        </label>
        <label>Secret Access Key
          <input type="password" value={secretAccessKey} onChange={(e) => setSecret(e.target.value)}
            placeholder={initial?.secretAccessKey ? '•••••• (guardada)' : ''} autoCapitalize="off" autoCorrect="off" spellCheck="false" />
        </label>
        {error && <div className="status err">{error}</div>}
        {busy && <div className="status">{busy}</div>}
        <div className="card-actions">
          {onCancel && <button type="button" className="pill" onClick={onCancel}>CANCELAR</button>}
          <button type="submit" className="pill on" disabled={!!busy}>CONECTAR</button>
        </div>
      </form>
    </div>
  );
}
