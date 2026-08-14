const pattern = /^\d+\.\d+\.\d+-\d{6}-(?:0[1-9]|[1-9]\d|[0-9a-f]{4,40})$/

export function requireProductVersion(value: string | undefined) {
  if (value && pattern.test(value)) return value
  throw new Error("Product Desktop build requires OPENCODE_VERSION in <base>-YYMMDD-(NN|shortCommitId) format")
}
