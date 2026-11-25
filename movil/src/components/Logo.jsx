export default function Logo({ large = false, pulse = false }) {
  return <div className={`logo-lockup${large ? ' large' : ''}${pulse ? ' pulse' : ''}`} aria-label="Pixel Deck">
    <img src="/pixeldeck.svg" alt="" width="40" height="40" />
    <span className="brand">pixel<b>deck</b><small>TU MÚSICA. TU ESPACIO.</small></span>
  </div>;
}
