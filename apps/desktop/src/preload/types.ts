export interface MurlApi {
  healthCheck(): Promise<{
    status: string;
    coreAlive: boolean;
    message: string;
  }>;
}
