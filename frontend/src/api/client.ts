import { Effect } from "effect";
import {
  FetchHttpClient,
  HttpApiClient,
  HttpClient,
  HttpClientRequest,
} from "@effect/platform";
import { AttendanceApi } from "@pbl/shared";
import { getToken } from "@/lib/auth.js";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

let cachedClient: any = null;

async function buildClient() {
  const raw = await Effect.runPromise(
    HttpApiClient.make(AttendanceApi, {
      baseUrl: API_BASE,
      transformClient: (client) =>
        client.pipe(
          HttpClient.mapRequest((request) => {
            const token = getToken();
            if (!token) return request;
            return HttpClientRequest.bearerToken(request, token);
          })
        ),
    }).pipe(Effect.provide(FetchHttpClient.layer))
  );

  // HttpApiClient methods return Effects; expose them as Promises so the
  // app can `await client.group.method(...)` directly.
  const wrapped: any = {};
  const rawAny = raw as Record<string, Record<string, (...args: any[]) => any>>;
  for (const group of Object.keys(rawAny)) {
    wrapped[group] = {};
    for (const method of Object.keys(rawAny[group])) {
      wrapped[group][method] = (...args: any[]) =>
        Effect.runPromise(rawAny[group][method](...args));
    }
  }
  return wrapped;
}

export async function getApiClient() {
  if (!cachedClient) {
    cachedClient = await buildClient();
  }
  return cachedClient;
}
