/** Matches the server's decoded image limit. */
export const MAX_TASK_COMPLETION_PHOTO_BYTES = 1_050_000;

export function validateTaskCompletionPhoto(photo: unknown): asserts photo is string {
  if (typeof photo !== "string") throw new Error("عکس انجام کار معتبر نیست.");
  const match = /^data:image\/(?:png|jpeg|webp);base64,/.exec(photo);
  if (!match) throw new Error("عکس انجام کار معتبر نیست.");
  const data = photo.slice(match[0].length);
  if (data.length > Math.ceil(MAX_TASK_COMPLETION_PHOTO_BYTES / 3) * 4) {
    throw new Error("حجم عکس بیش از حد مجاز است؛ عکس کوچک‌تری انتخاب کنید.");
  }
  if (!data.length || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    throw new Error("عکس انجام کار معتبر نیست.");
  }
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const bytes = data.length / 4 * 3 - padding;
  if (bytes > MAX_TASK_COMPLETION_PHOTO_BYTES) {
    throw new Error("حجم عکس بیش از حد مجاز است؛ عکس کوچک‌تری انتخاب کنید.");
  }
}
