export const ProofStatus = Object.freeze({ PASS: 'PASS', FAIL: 'FAIL', UNPROVEN: 'UNPROVEN' });

export function summarizeProofs(required, evidence = {}) {
  const rows = required.map((name) => ({ name, status: evidence[name]?.status || ProofStatus.UNPROVEN, details: evidence[name]?.details || null }));
  return {
    rows,
    pass: rows.filter((row) => row.status === ProofStatus.PASS).length,
    fail: rows.filter((row) => row.status === ProofStatus.FAIL).length,
    unproven: rows.filter((row) => row.status === ProofStatus.UNPROVEN).length,
    ready: rows.every((row) => row.status === ProofStatus.PASS),
  };
}
