import AsyncStorage from "@react-native-async-storage/async-storage";
import { workspacePreferenceKey } from "./config";

export async function savedMobileWorkspace(userId: string) {
  return AsyncStorage.getItem(workspacePreferenceKey(userId));
}
export async function saveMobileWorkspace(userId: string, workspaceId: string) {
  await AsyncStorage.setItem(workspacePreferenceKey(userId), workspaceId);
}
export async function clearMobileWorkspace(userId: string) {
  await AsyncStorage.removeItem(workspacePreferenceKey(userId));
}
