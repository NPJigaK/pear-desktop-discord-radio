import { normalizePearSong } from './search.js';
import type {
  PearConnectionConfig,
  PearControlAction,
  PearInsertPosition,
  PearSong,
  QueuePlacement,
} from './types.js';

type FetchLike = typeof fetch;

type UnknownRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function parseJsonResponse(response: Response): Promise<unknown> {
  return response.json() as Promise<unknown>;
}

function assertOk(response: Response, context: string): void {
  if (!response.ok) {
    throw new Error(`${context} failed with HTTP ${response.status}`);
  }
}

function readAccessToken(value: unknown): string {
  if (!isRecord(value) || typeof value.accessToken !== 'string' || value.accessToken.trim() === '') {
    throw new Error('Pear auth response did not include a usable accessToken');
  }

  return value.accessToken;
}

export interface PearClientOptions extends PearConnectionConfig {
  readonly fetch?: FetchLike | undefined;
}

export interface PearSearchRequest {
  readonly query: string;
  readonly params?: string | undefined;
  readonly continuation?: string | undefined;
}

export interface AddToQueueRequest {
  readonly videoId: string;
  readonly placement?: QueuePlacement | undefined;
}

export function mapControlActionPath(action: PearControlAction): string {
  switch (action) {
    case 'play':
      return '/api/v1/play';
    case 'pause':
      return '/api/v1/pause';
    case 'toggle-play':
      return '/api/v1/toggle-play';
    case 'next':
      return '/api/v1/next';
    case 'previous':
      return '/api/v1/previous';
  }
}

function readSong(value: unknown): PearSong {
  const song = normalizePearSong(value);
  if (song === null) {
    throw new Error('Pear song response did not include a valid song payload');
  }

  return song;
}

export function mapQueuePlacement(placement: QueuePlacement): PearInsertPosition {
  return placement === 'next'
    ? 'INSERT_AFTER_CURRENT_VIDEO'
    : 'INSERT_AT_END';
}

export class PearClient {
  private readonly baseUrl: string;

  private readonly clientId: string;

  private readonly fetchImpl: FetchLike;

  private accessToken: string | undefined;

  public constructor(options: PearClientOptions) {
    this.baseUrl = `http://${options.host}:${options.port}`;
    this.clientId = options.clientId;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  public async authenticate(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.accessToken !== undefined) {
      return this.accessToken;
    }

    const response = await this.fetchImpl(
      `${this.baseUrl}/auth/${encodeURIComponent(this.clientId)}`,
      {
        method: 'POST',
      },
    );

    if (response.status === 403) {
      throw new Error('Pear denied authentication for this client id');
    }

    assertOk(response, 'Pear auth');
    const body = await parseJsonResponse(response);
    const accessToken = readAccessToken(body);
    this.accessToken = accessToken;
    return accessToken;
  }

  public async getCurrentSong(): Promise<PearSong | null> {
    const response = await this.request('/api/v1/song', {
      method: 'GET',
    });

    if (response.status === 204) {
      return null;
    }

    const body = await parseJsonResponse(response);
    return readSong(body);
  }

  public async search(request: string | PearSearchRequest): Promise<unknown> {
    const payload =
      typeof request === 'string' ? { query: request } : request;
    const response = await this.request('/api/v1/search', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: {
        'content-type': 'application/json',
      },
    });

    return parseJsonResponse(response);
  }

  public async addToQueue(request: AddToQueueRequest): Promise<void> {
    const response = await this.request('/api/v1/queue', {
      method: 'POST',
      body: JSON.stringify({
        videoId: request.videoId,
        insertPosition: mapQueuePlacement(request.placement ?? 'queue'),
      }),
      headers: {
        'content-type': 'application/json',
      },
    });

    if (response.status !== 200 && response.status !== 204) {
      assertOk(response, 'Pear queue add');
    }
  }

  public async control(action: PearControlAction): Promise<void> {
    const response = await this.request(mapControlActionPath(action), {
      method: 'POST',
    });

    if (response.status !== 200 && response.status !== 204) {
      assertOk(response, `Pear control ${action}`);
    }
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const firstToken = await this.authenticate();
    let response = await this.performAuthenticatedRequest(path, init, firstToken);

    if (response.status !== 401) {
      assertOk(response, `Pear request ${path}`);
      return response;
    }

    const secondToken = await this.authenticate(true);
    response = await this.performAuthenticatedRequest(path, init, secondToken);
    assertOk(response, `Pear request ${path}`);
    return response;
  }

  private performAuthenticatedRequest(
    path: string,
    init: RequestInit,
    accessToken: string,
  ): Promise<Response> {
    return this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        authorization: `Bearer ${accessToken}`,
      },
    });
  }
}
