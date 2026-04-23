// Free US Census geocoder: https://geocoding.geo.census.gov
// Single-address endpoint (no auth). Returns lat/lng for US addresses.

export type GeocodeResult = { lat: number; lng: number } | null;

export async function geocodeAddress(
  street: string,
  city: string | null,
  state: string | null,
  zip: string | null,
): Promise<GeocodeResult> {
  if (!street) return null;
  const params = new URLSearchParams({
    street,
    benchmark: "Public_AR_Current",
    format: "json",
  });
  if (city) params.set("city", city);
  if (state) params.set("state", state);
  if (zip) params.set("zip", zip);

  const url = `https://geocoding.geo.census.gov/geocoder/locations/address?${params.toString()}`;
  try {
    const res = await fetch(url, {
      // Census is slow; allow up to 8s per lookup.
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const matches = data?.result?.addressMatches;
    if (!matches || matches.length === 0) return null;
    const coords = matches[0]?.coordinates;
    if (coords && typeof coords.x === "number" && typeof coords.y === "number") {
      return { lat: coords.y, lng: coords.x };
    }
  } catch {
    return null;
  }
  return null;
}
