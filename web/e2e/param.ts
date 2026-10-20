import { connect } from "node:net";

const MAVLINK_PORT = 5760;
const STX_V1 = 0xfe;
const STX_V2 = 0xfd;
const SIGNED = 0x01;
const PARAM_REQUEST_READ = 20;
const PARAM_REQUEST_READ_CRC = 214;
const PARAM_VALUE = 22;
const PARAM_VALUE_LENGTH = 25;
const GCS = [255, 190];
const AUTOPILOT = [1, 1];
const RETRY_MS = 500;
const TIMEOUT_MS = 30_000;

const x25 = (bytes: readonly number[]) =>
  bytes.reduce((crc, byte) => {
    const t = (byte ^ crc) & 0xff;
    const u = (t ^ (t << 4)) & 0xff;
    return ((crc >> 8) ^ (u << 8) ^ (u << 3) ^ (u >> 4)) & 0xffff;
  }, 0xffff);

const paramRequest = (name: string) => {
  const payload = [0xff, 0xff, ...AUTOPILOT, ...Buffer.from(name.padEnd(16, "\0"), "latin1")];
  const body = [payload.length, 0, ...GCS, PARAM_REQUEST_READ, ...payload];
  const crc = x25([...body, PARAM_REQUEST_READ_CRC]);
  return Buffer.from([STX_V1, ...body, crc & 0xff, crc >> 8]);
};

type Frame = { message: number; payload: Buffer };

const frames = (bytes: Buffer, found: readonly Frame[] = []): { rest: Buffer; found: readonly Frame[] } => {
  const start = bytes.indexOf(STX_V2);
  if (start < 0) return { rest: Buffer.alloc(0), found };
  const at = bytes.subarray(start);
  if (at.length < 10) return { rest: at, found };
  const length = at[1] ?? 0;
  const size = 12 + length + ((at[2] ?? 0) & SIGNED ? 13 : 0);
  if (at.length < size) return { rest: at, found };
  const message = (at[7] ?? 0) | ((at[8] ?? 0) << 8) | ((at[9] ?? 0) << 16);
  return frames(at.subarray(size), [...found, { message, payload: at.subarray(10, 10 + length) }]);
};

const paramValue = (frame: Frame) => {
  const payload = Buffer.concat([frame.payload, Buffer.alloc(PARAM_VALUE_LENGTH)]);
  return { name: payload.subarray(8, 24).toString("latin1").replace(/\0.*$/, ""), value: payload.readFloatLE(0) };
};

export const readParam = (name: string) =>
  new Promise<number>((resolve, reject) => {
    const socket = connect(MAVLINK_PORT, "127.0.0.1");
    const ask = setInterval(() => socket.write(paramRequest(name)), RETRY_MS);
    const finish = (settle: () => void) => {
      clearInterval(ask);
      clearTimeout(timeout);
      socket.destroy();
      settle();
    };
    const timeout = setTimeout(() => finish(() => reject(new Error(`The SITL never answered for ${name}`))), TIMEOUT_MS);
    const state = { pending: Buffer.alloc(0) };
    socket.on("error", (error) => finish(() => reject(error)));
    socket.on("data", (data: Buffer) => {
      const { rest, found } = frames(Buffer.concat([state.pending, data]));
      state.pending = rest;
      const answer = found
        .filter((frame) => frame.message === PARAM_VALUE)
        .map(paramValue)
        .find((param) => param.name === name);
      if (answer) finish(() => resolve(answer.value));
    });
  });
