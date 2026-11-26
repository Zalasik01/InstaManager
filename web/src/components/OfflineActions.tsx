/** Botão "Tentar de novo" da página /offline. */
export default function OfflineActions() {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="bg-accent text-accent-fg mt-6 rounded-lg px-4 py-2 font-bold"
    >
      Tentar de novo
    </button>
  );
}
