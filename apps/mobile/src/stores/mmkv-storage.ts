import { MMKV } from 'react-native-mmkv';
import { StateStorage } from 'zustand/middleware';

export const mmkv = new MMKV({ id: 'omnistate-storage' });

export const mmkvStorage: StateStorage = {
  getItem: (name) => mmkv.getString(name) ?? null,
  setItem: (name, value) => mmkv.set(name, value),
  removeItem: (name) => mmkv.delete(name),
};
