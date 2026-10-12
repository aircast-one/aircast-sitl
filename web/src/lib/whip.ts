const RETRY_MS = 2000;

const isPublishable = (codec: RTCRtpCodec) =>
  codec.mimeType === "video/rtx" ||
  (codec.mimeType === "video/H264" &&
    (codec.sdpFmtpLine ?? "").includes("packetization-mode=1"));

const iceGathered = (pc: RTCPeerConnection) =>
  new Promise<void>((resolve) => {
    const check = () => pc.iceGatheringState === "complete" && resolve();
    pc.addEventListener("icegatheringstatechange", check);
    check();
  });

async function connect(track: MediaStreamTrack, url: string, downscale: number) {
  const pc = new RTCPeerConnection();
  try {
    pc.addTransceiver(track, {
      direction: "sendonly",
      sendEncodings: [{ scaleResolutionDownBy: downscale }],
    }).setCodecPreferences(
      (RTCRtpSender.getCapabilities("video")?.codecs ?? []).filter(isPublishable),
    );
    await pc.setLocalDescription(await pc.createOffer());
    await iceGathered(pc);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: pc.localDescription!.sdp,
    });
    if (!res.ok) throw new Error(`WHIP ${url} answered ${res.status}`);
    await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
    return pc;
  } catch (e) {
    pc.close();
    throw e;
  }
}

export function publishWhip(track: MediaStreamTrack, url: string, downscale = 1): () => void {
  const session: {
    pc?: RTCPeerConnection;
    timer?: ReturnType<typeof setTimeout>;
    stopped: boolean;
  } = { stopped: false };

  const retry = (reason: unknown) => {
    console.warn("WHIP publish lost, retrying", reason);
    session.pc?.close();
    session.pc = undefined;
    session.timer = session.stopped ? undefined : setTimeout(start, RETRY_MS);
  };

  const start = () =>
    connect(track, url, downscale)
      .then((pc) => {
        if (session.stopped) return pc.close();
        session.pc = pc;
        pc.addEventListener("connectionstatechange", () =>
          ["failed", "closed"].includes(pc.connectionState) && session.pc === pc
            ? retry(pc.connectionState)
            : undefined,
        );
      })
      .catch(retry);

  start();

  return () => {
    session.stopped = true;
    clearTimeout(session.timer);
    session.pc?.close();
  };
}
