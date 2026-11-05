function publicCatalogFilter() {
  const legacyRecord = () => ({
    visibility: { $exists: false },
    catalogStatus: { $exists: false },
    uploadSource: { $exists: false },
    uploadedBy: { $exists: false },
    ownerId: { $exists: false },
  });
  return {
    $and: [
      { $or: [{ visibility: 'public' }, legacyRecord()] },
      { $or: [{ catalogStatus: 'approved' }, legacyRecord()] },
      { $or: [{ uploadSource: { $in: ['admin', 'legacy'] } }, legacyRecord()] },
      { $or: [{ mediaStatus: 'active' }, { mediaStatus: { $exists: false } }] },
    ],
  };
}

function ownedPrivateSongFilter(userId) {
  return {
    visibility: 'private',
    uploadSource: 'user',
    mediaStatus: 'active',
    $or: [{ uploadedBy: userId }, { ownerId: userId }],
  };
}

function accessibleSongFilter(userId, songIds) {
  const publicCatalog = publicCatalogFilter();
  return {
    _id: { $in: songIds },
    $or: [
      publicCatalog,
      ...(userId ? [{ visibility: 'private', uploadSource: 'user', mediaStatus: 'active', $or: [{ uploadedBy: userId }, { ownerId: userId }] }] : []),
    ],
  };
}

function adminCatalogFilter(status) {
  return {
    visibility: 'public',
    uploadSource: 'admin',
    ...(status ? { catalogStatus: status } : {}),
    mediaStatus: 'active',
  };
}

module.exports = { accessibleSongFilter, adminCatalogFilter, ownedPrivateSongFilter, publicCatalogFilter };
