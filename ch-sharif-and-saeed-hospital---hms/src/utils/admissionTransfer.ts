import type { Bed, Room, Ward } from '../types/wardsRoomsBeds';

export const STANDALONE_ROOM = '__standalone_room__';

export function transferLocations(wards: Ward[], rooms: Room[], beds: Bed[], wardId: string, roomId: string, currentBedId?: string | null) {
  const activeWards = wards.filter((ward) => ward.status === 'Active');
  const activeRooms = rooms.filter((room) => room.status === 'Active' &&
    (!room.wardId || activeWards.some((ward) => ward.id === room.wardId)));
  const availableRooms = activeRooms.filter((room) => {
    if (!wardId) return true;
    if (wardId === STANDALONE_ROOM) return !room.wardId;
    return room.wardId === wardId;
  });
  const availableBeds = beds
    .filter((bed) => {
      if (bed.id === currentBedId || bed.occupancyStatus !== 'Available' || bed.operationalStatus !== 'Active') return false;
      const room = bed.roomId ? availableRooms.find((item) => item.id === bed.roomId) : undefined;
      if (roomId) return room?.id === roomId;
      if (wardId === STANDALONE_ROOM) return false;
      if (wardId) return bed.roomId ? !!room : bed.wardId === wardId && activeWards.some((ward) => ward.id === wardId);
      return false;
    })
    .sort((a, b) => (a.bedNumber || '').localeCompare(b.bedNumber || '', undefined, { numeric: true, sensitivity: 'base' }));
  return { activeWards, availableRooms, availableBeds, hasStandaloneRooms: activeRooms.some((room) => !room.wardId) };
}
