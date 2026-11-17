import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { create } from "zustand";
import { toast } from "sonner";
import { bumpMediaEpoch } from "./media";

/** Bima Cloud: Supabase (accounts + projects) + Cloudflare R2 (media). The sync engine
 *  runs in Rust; this module holds UI state and the realtime subscription that makes a
 *  change on one computer show up on the others within a second or two. */
const SUPABASE_URL = "https://iavnqpirnihirkvpnvpg.supabase.co";
const SUPABASE_KEY = "sb_publishable_JRIwBhmYICh6LSpdvqd-Lw_vjfiN8oI";

export interface CloudAccount {
  id: string;
  email: string;
}

export interface CloudSync {
  state: "off" | "syncing" | "idle" | "offline" | "error";
  message: string;
  progress: [number, number] | null;
  lastSync: number;
}

export const useCloud = create<{
  signedIn: boolean;
  account: CloudAccount | null;
  sync: CloudSync;
  live: boolean; // realtime connected
}>(() => ({
  signedIn: false,
  account: null,
  sync: { state: "off", message: "", progress: null, lastSync: 0 },
  live: false,
}));

export async function refreshCloud() {
  const s = await invoke<{ signedIn: boolean; account: CloudAccount | null }>("cloud_status").catch(() => null);
  if (s) useCloud.setState({ signedIn: s.signedIn, account: s.account });
  if (s?.signedIn) void startRealtime();
  else stopRealtime();
  return s;
}

/* ------------------------------------------------------------------ realtime */

let supa: SupabaseClient | null = null;
let channel: RealtimeChannel | null = null;
let realtimeTimer: ReturnType<typeof setTimeout> | undefined;

/** This installation's id: events this computer caused itself are ignored (no echo pass). */
let myDevice = "";
invoke<string>("cloud_device_id")
  .then((d) => (myDevice = d))
  .catch(() => {});

function onRemoteChange(payload?: { new?: { device?: string } }) {
  if (myDevice && payload?.new?.device === myDevice) return;
  clearTimeout(realtimeTimer);
  realtimeTimer = setTimeout(() => invoke("cloud_sync_now").catch(() => {}), 400);
}

let authTimer: ReturnType<typeof setInterval> | undefined;

let starting = false;
async function startRealtime() {
  if (channel || starting) return;
  starting = true;
  try {
    await openChannel();
  } finally {
    starting = false;
  }
}

async function openChannel() {
  supa ??= createClient(SUPABASE_URL, SUPABASE_KEY, {
    // tokens come from the Rust side (refresh token lives in the Windows credential store)
    accessToken: () => invoke<string>("cloud_access_token").catch(() => SUPABASE_KEY),
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = await invoke<string>("cloud_access_token").catch(() => null);
  if (!token || channel) return;
  // the realtime socket must carry the user's token, or RLS filters every event out
  await supa.realtime.setAuth(token);
  channel = supa
    .channel("bima-projects")
    // a project or a media file changed on another computer → sync now (bursts coalesced)
    .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, onRemoteChange)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "media" }, onRemoteChange)
    .subscribe((status) => {
      const live = status === "SUBSCRIBED";
      // (re)connected: events may have been missed while we were away → catch up once
      if (live && !useCloud.getState().live) invoke("cloud_sync_now").catch(() => {});
      useCloud.setState({ live });
    });
  // access tokens live 1 h - hand the socket a fresh one well before that
  clearInterval(authTimer);
  authTimer = setInterval(async () => {
    const t = await invoke<string>("cloud_access_token").catch(() => null);
    if (t) await supa?.realtime.setAuth(t);
  }, 30 * 60 * 1000);
}

function stopRealtime() {
  clearInterval(authTimer);
  if (!channel) return;
  supa?.removeChannel(channel);
  channel = null;
  useCloud.setState({ live: false });
}

/* ------------------------------------------------------------------ wiring */

let started = false;
/** Wire cloud events once. `onPulled` reloads sessions that changed on another computer. */
export function startCloud(onPulled: (ids: string[]) => void) {
  if (started) return;
  started = true;
  // network back → sync immediately (and reset the engine's retry backoff)
  window.addEventListener("online", () => invoke("cloud_network_online").catch(() => {}));
  refreshCloud();
  listen<CloudSync>("cloud-status", (e) => useCloud.setState({ sync: e.payload })).catch(() => {});
  listen<string[]>("cloud-pulled", (e) => onPulled(e.payload)).catch(() => {});
  listen<string>("cloud-media-ready", () => bumpMediaEpoch()).catch(() => {});
  listen<CloudAccount>("cloud-signed-in", (e) => {
    useCloud.setState({ signedIn: true, account: e.payload });
    toast.success(`מחובר כ-${e.payload.email}`);
    void startRealtime();
  }).catch(() => {});
  listen("cloud-signed-out", () => {
    useCloud.setState({ signedIn: false });
    stopRealtime();
  }).catch(() => {});
}

let kickTimer: ReturnType<typeof setTimeout> | undefined;
/** Ask the engine to push local changes soon (debounced). */
export function requestSync(delay = 700) {
  if (!useCloud.getState().signedIn) return;
  clearTimeout(kickTimer);
  kickTimer = setTimeout(() => invoke("cloud_sync_now").catch(() => {}), delay);
}

/** Email a sign-in link; Bima signs in by itself when it's clicked on this computer. */
export async function sendLink(email: string) {
  await invoke("cloud_send_link", { email });
}

export async function sendCode(email: string) {
  await invoke("cloud_send_code", { email });
}

export async function verifyCode(email: string, code: string) {
  const account = await invoke<CloudAccount>("cloud_verify_code", { email, code });
  useCloud.setState({ signedIn: true, account });
  void startRealtime();
  return account;
}

export async function signOut() {
  stopRealtime();
  await invoke("cloud_logout");
  useCloud.setState({ signedIn: false, account: null, sync: { state: "off", message: "", progress: null, lastSync: 0 } });
}
