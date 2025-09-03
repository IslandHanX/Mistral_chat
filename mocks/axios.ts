// Vitest 会优先使用这个 mock
const axios: any = {
  post: vi.fn(),
};
export default axios;
export { axios };
