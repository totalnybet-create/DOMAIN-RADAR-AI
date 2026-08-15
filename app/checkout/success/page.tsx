import CheckoutStatusClient from "./status-client";

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; provider?: string; order_id?: string }>;
}) {
  const params = await searchParams;
  const provider = params.provider === "hotpay" ? "hotpay" : "stripe";
  const identifier = provider === "hotpay" ? params.order_id || "" : params.session_id || "";

  return (
    <main className="shell checkoutShell">
      <section className="hero checkoutHero">
        <div className="eyebrow">DOMENAGO · ZAMÓWIENIE</div>
        <h1>Finalizacja zakupu</h1>
        <p>Płatność i rejestracja są weryfikowane serwerowo. Nie musisz ponownie klikać „Kup”.</p>
      </section>
      <CheckoutStatusClient provider={provider} identifier={identifier} />
    </main>
  );
}
