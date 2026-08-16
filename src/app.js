function extractPlaylistId(value) {
  if (!value) return "";
  if (/^[\w-]+$/.test(value)) return value;
  try {
    const url = new URL(value, window.location.origin);
    return url.searchParams.get("list") || "";
  } catch { return ""; }
}

const requestedPlaylist = new URLSearchParams(window.location.search).get("playlist");
let playlistId = extractPlaylistId(requestedPlaylist);
let playlistUrl = playlistId ? `https://music.youtube.com/playlist?list=${encodeURIComponent(playlistId)}` : "";

const $ = (selector) => document.querySelector(selector);
const playerCard = $("#player");
const playButton = $("#playButton");
const seekSlider = $("#seekSlider");
const timelineFill = $("#timelineFill");
const trackTitle = $("#trackTitle");
const trackArtist = $("#trackArtist");
const albumArt = $("#albumArt");
const currentTime = $("#currentTime");
const duration = $("#duration");
const queueList = $("#queueList");
const queueButton = $("#queueButton");
const queuePanel = $("#queuePanel");
const queueScrim = $("#queueScrim");
const heartButton = $("#heartButton");
const volumeButton = $("#volumeButton");
const shuffleButton = $("#shuffleButton");
const lightSwitch = $("#lightSwitch");
const playlistLink = $("#playlistLink");
const toast = $("#toast");

let tracks = [];
let currentIndex = 0;
let wantsToPlay = false;
let shuffleOn = false;
let playerReady = false;
let youtubePlayer;
let progressTimer;
let playlistSyncTimer;
let toastTimer;
const likedTracks = new Set();

async function loadPlaylistSource() {
  if (playlistId) {
    playlistLink.href = playlistUrl;
    return;
  }

  try {
    const response = await fetch("/playlist.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Playlist snapshot is missing");
    const snapshot = await response.json();
    playlistId = snapshot.playlistId;
    playlistUrl = snapshot.playlistUrl || `https://music.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`;
    tracks = Array.isArray(snapshot.tracks) ? snapshot.tracks : [];
    playlistLink.href = playlistUrl;
    renderQueue();
    updateTrackUI({ animate: false });
  } catch {
    trackTitle.textContent = "Playlist sync needed";
    trackArtist.textContent = "Run npm run sync:playlist";
  }
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[character]);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 1900);
}

function setAmbientMode(ambient, announce = true) {
  document.body.classList.toggle("ambient-mode", ambient);
  lightSwitch.setAttribute("aria-pressed", String(ambient));
  lightSwitch.setAttribute("aria-label", ambient ? "Turn the main light on" : "Turn the main light off");
  lightSwitch.querySelector(".switch-tooltip").textContent = ambient ? "main light off" : "main light";
  localStorage.setItem("roomies-main-light", ambient ? "off" : "on");
  if (announce) showToast(ambient ? "Main light off · tiny lights stay on" : "Main light back on");
}

function renderQueue() {
  $("#queueCount").textContent = tracks.length || "…";
  if (!tracks.length) {
    queueList.innerHTML = '<div class="queue-loading"><span><i></i>Reading the YouTube Music playlist…</span></div>';
    return;
  }

  queueList.innerHTML = tracks.map((track, index) => `
    <button class="queue-item ${index === currentIndex ? "active" : ""}" data-index="${index}" type="button" aria-label="Play ${escapeHtml(track.title)} by ${escapeHtml(track.artist)}">
      <img src="${escapeHtml(track.art)}" alt="" loading="lazy" />
      <span class="queue-item-copy"><strong>${escapeHtml(track.title)}</strong><span>${escapeHtml(track.artist)}</span></span>
      <span class="track-number">${String(index + 1).padStart(2, "0")}</span>
    </button>
  `).join("");
}

function animateTrackChange() {
  playerCard.classList.remove("track-changing");
  void playerCard.offsetWidth;
  playerCard.classList.add("track-changing");
  setTimeout(() => playerCard.classList.remove("track-changing"), 650);
}

function updateTrackUI({ resetProgress = true, animate = true } = {}) {
  const track = tracks[currentIndex];
  if (!track) {
    trackTitle.textContent = "Syncing your playlist…";
    trackArtist.textContent = "YouTube Music";
    albumArt.removeAttribute("src");
    albumArt.alt = "";
    return;
  }

  trackTitle.textContent = track.title;
  trackArtist.textContent = track.artist;
  albumArt.src = track.art;
  albumArt.alt = `${track.title} artwork`;
  heartButton.setAttribute("aria-pressed", likedTracks.has(track.id));
  if (resetProgress) {
    seekSlider.value = 0;
    timelineFill.style.width = "0%";
    currentTime.textContent = "0:00";
    duration.textContent = "0:00";
  }
  if (animate) animateTrackChange();
}

async function hydrateMetadata() {
  for (let offset = 0; offset < tracks.length; offset += 5) {
    const batch = tracks.slice(offset, offset + 5);
    await Promise.allSettled(batch.map(async track => {
      const endpoint = `https://noembed.com/embed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${track.id}`)}`;
      const response = await fetch(endpoint);
      if (!response.ok) return;
      const metadata = await response.json();
      if (metadata.title) track.title = metadata.title;
      if (metadata.author_name) track.artist = metadata.author_name;
      if (metadata.thumbnail_url) track.art = metadata.thumbnail_url;
    }));
    renderQueue();
    updateTrackUI({ resetProgress: false, animate: false });
  }
}

function syncPlaylistFromPlayer(attempt = 0) {
  if (!playerReady) return;
  const ids = youtubePlayer.getPlaylist?.() || [];
  if (!ids.length) {
    if (attempt < 12) {
      clearTimeout(playlistSyncTimer);
      playlistSyncTimer = setTimeout(() => syncPlaylistFromPlayer(attempt + 1), 400);
    } else {
      playerCard.classList.remove("is-loading");
      trackTitle.textContent = "Playlist could not be loaded";
      trackArtist.textContent = "Make sure it is public or unlisted";
      queueList.innerHTML = '<div class="queue-loading">This playlist is unavailable.<br />Check the shared link and privacy setting.</div>';
    }
    return;
  }

  const previousTracks = new Map(tracks.map(track => [track.id, track]));
  tracks = ids.map((id, index) => previousTracks.get(id) || ({
    id,
    title: `Playlist track ${String(index + 1).padStart(2, "0")}`,
    artist: "YouTube Music",
    art: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
  }));
  currentIndex = Math.max(0, youtubePlayer.getPlaylistIndex?.() || 0);
  renderQueue();
  updateTrackUI();
  hydrateMetadata();
}

function updatePlayingMetadata() {
  if (!playerReady || !tracks[currentIndex]) return;
  const metadata = youtubePlayer.getVideoData?.();
  if (!metadata) return;
  if (metadata.title) tracks[currentIndex].title = metadata.title;
  if (metadata.author) tracks[currentIndex].artist = metadata.author;
  updateTrackUI({ resetProgress: false, animate: false });
  renderQueue();
}

function loadTrack(index, autoplay = wantsToPlay) {
  if (!tracks.length) return;
  currentIndex = (index + tracks.length) % tracks.length;
  wantsToPlay = autoplay;
  updateTrackUI();
  renderQueue();
  playerCard.classList.toggle("is-loading", autoplay);
  playerCard.classList.remove("is-playing");
  if (!playerReady) return;
  if (autoplay) youtubePlayer.playVideoAt(currentIndex);
  else youtubePlayer.cuePlaylist({ listType: "playlist", list: playlistId, index: currentIndex, startSeconds: 0 });
}

function setPlayingState(playing) {
  playerCard.classList.toggle("is-playing", playing);
  playerCard.classList.remove("is-loading");
  playButton.setAttribute("aria-label", playing ? "Pause" : "Play");
  playButton.setAttribute("aria-pressed", playing);
}

function updateProgress() {
  if (!playerReady) return;
  const elapsed = youtubePlayer.getCurrentTime() || 0;
  const total = youtubePlayer.getDuration() || 0;
  const percent = total ? (elapsed / total) * 100 : 0;
  seekSlider.value = percent;
  timelineFill.style.width = `${percent}%`;
  currentTime.textContent = formatTime(elapsed);
  duration.textContent = formatTime(total);
}

function startProgress() {
  clearInterval(progressTimer);
  updateProgress();
  progressTimer = setInterval(updateProgress, 250);
}

function play() {
  wantsToPlay = true;
  playerCard.classList.add("is-loading");
  if (!playerReady) {
    showToast("Waking up the speakers…");
    return;
  }
  youtubePlayer.playVideo();
}

function pause() {
  wantsToPlay = false;
  if (playerReady) youtubePlayer.pauseVideo();
}

function togglePlay() {
  const playing = playerReady && youtubePlayer.getPlayerState() === window.YT.PlayerState.PLAYING;
  if (playing) pause(); else play();
}

function randomNext() {
  if (tracks.length < 2) return currentIndex;
  let next = currentIndex;
  while (next === currentIndex) next = Math.floor(Math.random() * tracks.length);
  return next;
}

function nextTrack() { loadTrack(shuffleOn ? randomNext() : currentIndex + 1, wantsToPlay); }

function previousTrack() {
  if (playerReady && youtubePlayer.getCurrentTime() > 3) {
    youtubePlayer.seekTo(0, true);
    return;
  }
  loadTrack(currentIndex - 1, wantsToPlay);
}

function setQueue(open) {
  document.body.classList.toggle("queue-open", open);
  queueButton.setAttribute("aria-expanded", open);
  queuePanel.setAttribute("aria-hidden", !open);
  if (open) queuePanel.querySelector(".queue-item.active")?.scrollIntoView({ block: "nearest" });
}

const playlistReady = loadPlaylistSource();

window.onYouTubeIframeAPIReady = async () => {
  await playlistReady;
  if (!playlistId) return;
  youtubePlayer = new window.YT.Player("youtubePlayer", {
    width: "200",
    height: "200",
    playerVars: {
      autoplay: 0,
      controls: 0,
      disablekb: 1,
      playsinline: 1,
      rel: 0,
      listType: "playlist",
      list: playlistId,
      origin: window.location.origin,
      widget_referrer: window.location.href
    },
    events: {
      onReady: () => {
        playerReady = true;
        document.body.dataset.youtube = "ready";
        youtubePlayer.setVolume(88);
        youtubePlayer.cuePlaylist({ listType: "playlist", list: playlistId, index: 0, startSeconds: 0 });
        syncPlaylistFromPlayer();
      },
      onStateChange: ({ data }) => {
        document.body.dataset.youtubeState = String(data);
        if (data === window.YT.PlayerState.PLAYING) {
          const playlistIndex = youtubePlayer.getPlaylistIndex?.();
          if (Number.isInteger(playlistIndex) && playlistIndex >= 0 && playlistIndex !== currentIndex) {
            currentIndex = playlistIndex;
            updateTrackUI();
            renderQueue();
          }
          wantsToPlay = true;
          setPlayingState(true);
          startProgress();
          updatePlayingMetadata();
        } else if (data === window.YT.PlayerState.BUFFERING) {
          if (wantsToPlay) playerCard.classList.add("is-loading");
        } else if (data === window.YT.PlayerState.ENDED) {
          nextTrack();
        } else if (data === window.YT.PlayerState.CUED) {
          syncPlaylistFromPlayer();
          setPlayingState(false);
          if (wantsToPlay) youtubePlayer.playVideo();
        } else if (data === window.YT.PlayerState.PAUSED) {
          setPlayingState(false);
          updateProgress();
        }
      },
      onError: ({ data }) => {
        document.body.dataset.youtubeError = String(data);
        setPlayingState(false);
        if (wantsToPlay) {
          showToast("That upload missed curfew — skipping");
          setTimeout(nextTrack, 700);
        }
      },
      onAutoplayBlocked: () => {
        wantsToPlay = false;
        setPlayingState(false);
        showToast("Tap play to start the room");
      }
    }
  });
};

const youtubeScript = document.createElement("script");
youtubeScript.src = "https://www.youtube.com/iframe_api";
document.head.appendChild(youtubeScript);

playButton.addEventListener("click", togglePlay);
$("#nextButton").addEventListener("click", nextTrack);
$("#prevButton").addEventListener("click", previousTrack);
queueButton.addEventListener("click", () => setQueue(!document.body.classList.contains("queue-open")));
$("#queueClose").addEventListener("click", () => setQueue(false));
queueScrim.addEventListener("click", () => setQueue(false));

queueList.addEventListener("click", (event) => {
  const item = event.target.closest(".queue-item");
  if (!item) return;
  loadTrack(Number(item.dataset.index), true);
  if (window.innerWidth < 720) setQueue(false);
});

seekSlider.addEventListener("input", () => {
  if (!playerReady) return;
  const total = youtubePlayer.getDuration() || 0;
  if (total) youtubePlayer.seekTo((Number(seekSlider.value) / 100) * total, true);
});

heartButton.addEventListener("click", () => {
  const track = tracks[currentIndex];
  if (!track) return;
  if (likedTracks.has(track.id)) {
    likedTracks.delete(track.id);
    showToast("Removed from your getting-ready set");
  } else {
    likedTracks.add(track.id);
    showToast("Saved for tomorrow night ♡");
  }
  heartButton.setAttribute("aria-pressed", likedTracks.has(track.id));
});

shuffleButton.addEventListener("click", () => {
  shuffleOn = !shuffleOn;
  shuffleButton.setAttribute("aria-pressed", shuffleOn);
  showToast(shuffleOn ? "Chaos mode: on" : "Playing in order");
});

$("#shuffleQueue").addEventListener("click", () => {
  if (!tracks.length) return;
  shuffleOn = true;
  shuffleButton.setAttribute("aria-pressed", "true");
  loadTrack(randomNext(), true);
  showToast("Queue officially ungovernable");
});

$("#moodButton").addEventListener("click", () => {
  if (!tracks.length) return;
  shuffleOn = true;
  shuffleButton.setAttribute("aria-pressed", "true");
  loadTrack(randomNext(), true);
  showToast("Someone stole the aux ✦");
});

volumeButton.addEventListener("click", () => {
  if (!playerReady) return;
  const muted = youtubePlayer.isMuted();
  if (muted) youtubePlayer.unMute(); else youtubePlayer.mute();
  document.body.classList.toggle("is-muted", !muted);
  volumeButton.setAttribute("aria-label", muted ? "Mute" : "Unmute");
});

lightSwitch.addEventListener("click", () => {
  setAmbientMode(!document.body.classList.contains("ambient-mode"));
  navigator.vibrate?.(16);
});

document.addEventListener("keydown", (event) => {
  if (event.target.matches("input")) return;
  if (event.code === "Space") { event.preventDefault(); togglePlay(); }
  if (event.code === "ArrowRight") nextTrack();
  if (event.code === "ArrowLeft") previousTrack();
  if (event.code === "KeyL") setAmbientMode(!document.body.classList.contains("ambient-mode"));
  if (event.code === "Escape") setQueue(false);
});

const background = new Image();
let revealTimer = setTimeout(() => document.body.classList.add("loaded"), 1400);
background.onload = () => {
  clearTimeout(revealTimer);
  setTimeout(() => document.body.classList.add("loaded"), 300);
};
background.src = "/art/roomies-hostel.webp";

if (localStorage.getItem("roomies-main-light") === "off") setAmbientMode(true, false);
$("#roomieCount").textContent = String(8 + Math.floor(Math.random() * 9));
renderQueue();
updateTrackUI();
