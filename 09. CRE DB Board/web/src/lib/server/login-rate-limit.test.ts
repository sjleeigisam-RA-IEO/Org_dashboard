import {describe,expect,it,vi} from "vitest";
import {clearLoginAttempts,consumeLoginAttempts,loginRateLimitKeys} from "@/lib/server/login-rate-limit";
const SECRET="0123456789abcdef0123456789abcdef";
describe("loginRateLimitKeys",()=>{
 it("prefers the Vercel-controlled forwarding header when forwarded headers conflict",async()=>{
  const conflicting=new Request("https://example.com/api/auth/login",{headers:{"x-vercel-forwarded-for":"203.0.113.7, 10.0.0.1","x-real-ip":"198.51.100.9","x-forwarded-for":"192.0.2.5"}});
  const vercelOnly=new Request("https://example.com/api/auth/login",{headers:{"x-vercel-forwarded-for":"203.0.113.7"}});
  const spoofOnly=new Request("https://example.com/api/auth/login",{headers:{"x-real-ip":"198.51.100.9"}});
  const [conflict,vercel,spoof]=await Promise.all([loginRateLimitKeys(conflicting,SECRET,"person@example.com"),loginRateLimitKeys(vercelOnly,SECRET,"person@example.com"),loginRateLimitKeys(spoofOnly,SECRET,"person@example.com")]);
  expect(conflict[0]).toBe(vercel[0]);
  expect(conflict[0]).not.toBe(spoof[0]);
  expect(conflict[1]).toBe(vercel[1]);
 });
 it("updates and clears both pseudonymous keys with one database call each",async()=>{
  const execute=vi.fn().mockResolvedValueOnce({rows:[{blocked:false}]}).mockResolvedValueOnce({rows:[]});
  const keys=["key-a","key-b"];
 expect(await consumeLoginAttempts(execute,keys)).toBe(false);
  await clearLoginAttempts(execute,keys);
  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute.mock.calls[0][1]).toEqual(keys);
  expect(execute.mock.calls[1][1]).toEqual(keys);
  expect(execute.mock.calls[0][0]).toContain("VALUES ($1::text), ($2::text)");
  expect(execute.mock.calls[0][0]).not.toContain("jsonb_array_elements_text");
  expect(execute.mock.calls[0][0]).toContain("bool_or(blocked)");
 });
 it("pads a single limiter key without introducing a JSON parameter",async()=>{
  const execute=vi.fn().mockResolvedValue({rows:[{blocked:false}]});
  await consumeLoginAttempts(execute,["key-a"]);
  expect(execute.mock.calls[0][1]).toEqual(["key-a","key-a"]);
 });
 it("returns blocked when either batched limiter row is blocked",async()=>{
  const execute=vi.fn().mockResolvedValue({rows:[{blocked:true}]});
  expect(await consumeLoginAttempts(execute,["key-a","key-b"])).toBe(true);
 });
 });
