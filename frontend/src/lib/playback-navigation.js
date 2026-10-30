export function getAdjacentSongIndex(currentIndex, songCount, direction = 1) {
  if (!Number.isSafeInteger(songCount) || songCount < 1) return -1;
  const step = direction < 0 ? -1 : 1;
  const isValidCurrentIndex = Number.isSafeInteger(currentIndex) && currentIndex >= 0 && currentIndex < songCount;
  const baseIndex = isValidCurrentIndex ? currentIndex : step > 0 ? -1 : 0;
  return (baseIndex + step + songCount) % songCount;
}
