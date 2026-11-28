declare module "virtual:release-history" {
  const history: import("./domain/release-history/release-history").ReleaseHistoryData;
  export default history;
}
