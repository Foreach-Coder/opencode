export const FILE_REFERENCE_DRAG_TYPE = "application/x-opencode-file-reference"

export function hasFileReferenceDrag(types: readonly string[]) {
  return types.includes(FILE_REFERENCE_DRAG_TYPE)
}
