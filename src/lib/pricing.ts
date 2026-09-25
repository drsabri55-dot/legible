// Prices shown on the site and in emails. The amount actually charged for a
// report comes from REPORT_PRICE_CENTS so it can change without a deploy.

export function formatUsd(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

export function reportPriceCents(): number {
  const value = Number(process.env.REPORT_PRICE_CENTS || 9900);
  return Number.isInteger(value) && value >= 50 ? value : 9900;
}

export const MONITORING_PRICE = "$39";
