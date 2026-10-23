const PAGE_SIZE = 100;
const MAX_CATALOG_PAGES = 100;

export async function fetchAllSongPages(fetchPage, { maxPages = MAX_CATALOG_PAGES } = {}) {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) {
    throw new Error('The song catalog page limit must be a positive integer.');
  }
  const pageLimit = Math.min(maxPages, MAX_CATALOG_PAGES);
  const songs = [];
  let expectedTotal;
  let expectedTotalPages;

  for (let page = 1; page <= pageLimit; page += 1) {
    const response = await fetchPage(page, PAGE_SIZE);
    const { songs: pageSongs, pagination } = response || {};

    if (!Array.isArray(pageSongs) || !pagination ||
        !Number.isSafeInteger(pagination.page) || !Number.isSafeInteger(pagination.limit) ||
        !Number.isSafeInteger(pagination.total) || !Number.isSafeInteger(pagination.totalPages) ||
        pagination.total < 0 || pagination.totalPages < 0 || pagination.limit !== PAGE_SIZE ||
        pagination.page !== page || pagination.totalPages !== Math.ceil(pagination.total / PAGE_SIZE) ||
        pageSongs.length > PAGE_SIZE) {
      throw new Error('The song catalog returned invalid pagination data.');
    }

    if (page === 1) {
      expectedTotal = pagination.total;
      expectedTotalPages = pagination.totalPages;
      if (expectedTotalPages > pageLimit) {
        throw new Error(`The song catalog exceeds the ${pageLimit}-page limit.`);
      }
      if (expectedTotalPages === 0) {
        if (pageSongs.length !== 0) throw new Error('The song catalog returned records for an empty page range.');
        return songs;
      }
    } else if (pagination.total !== expectedTotal || pagination.totalPages !== expectedTotalPages) {
      throw new Error('The song catalog changed while pages were being loaded. Please try again.');
    }

    const expectedPageSize = page < expectedTotalPages
      ? PAGE_SIZE
      : expectedTotal - PAGE_SIZE * (expectedTotalPages - 1);
    if (pageSongs.length !== expectedPageSize) {
      throw new Error('The song catalog changed while pages were being loaded. Please try again.');
    }
    songs.push(...pageSongs);
    if (page === expectedTotalPages) return songs;
  }

  throw new Error(`The song catalog exceeds the ${pageLimit}-page limit.`);
}
