import CheckoutStatusClient from "./status-client";

export default async function CheckoutSuccessPage({ searchParams }: { searchParams: Promise<{ session_id?: string }> }) {
  const params = await searchParams;
  return (
    <main className="shell checkoutShell">
      <section className="hero checkoutHero">
        <div className="eyebrow">DOMAIN RADAR · ZAMÓWIENIE</div>
        <h1>Finalizacja zakupu</h1>
        <p>Płatność i rejestracja są weryfikowane serwerowo. Nie musisz ponownie klikać „Kup”.</p>
      </section>
      <CheckoutStatusClient sessionId={params.session_id || ""} />
    </main>
  );
}
