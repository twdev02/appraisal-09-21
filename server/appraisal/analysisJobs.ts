import { randomUUID } from 'node:crypto';

type AnalysisHandler = (req: any, res: any) => Promise<void>;
type Job = {
  status: 'running' | 'completed';
  statusCode: number;
  body?: any;
  completedAt?: number;
};

// This app runs in one persistent Express process. IDs are unguessable bearer
// tokens; results are retained briefly so a dropped polling request is harmless.
export class AnalysisJobs {
  private readonly jobs = new Map<string, Job>();

  constructor(private readonly handler: AnalysisHandler) {}

  private prune() {
    for (const [id, job] of this.jobs) {
      if (job.completedAt && Date.now() - job.completedAt > 15 * 60_000) {
        this.jobs.delete(id);
      }
    }
  }

  start(req: any): string | null {
    this.prune();
    if ([...this.jobs.values()].filter(job => job.status === 'running').length >= 4) return null;
    // Bound retained document/results memory, including rapid sequential jobs.
    if (this.jobs.size >= 32) {
      const oldest = [...this.jobs].find(([, job]) => job.status === 'completed');
      if (oldest) this.jobs.delete(oldest[0]);
    }
    const id = randomUUID();
    const job: Job = { status: 'running', statusCode: 200 };
    this.jobs.set(id, job);

    // Do not retain or operate on the upload socket after sending HTTP 202.
    const input = { body: req.body, file: req.file, setTimeout() {} };
    const response = {
      headersSent: false,
      setTimeout() {},
      status(code: number) { job.statusCode = code; return this; },
      json(body: any) {
        if (this.headersSent) return this;
        this.headersSent = true;
        job.body = body;
        job.status = 'completed';
        job.completedAt = Date.now();
        const cleanup = setTimeout(() => thisJobs.delete(id), 15 * 60_000);
        cleanup.unref();
        return this;
      },
    };
    const thisJobs = this.jobs;
    setImmediate(async () => {
      try {
        await this.handler(input, response);
        if (!response.headersSent) throw new Error('Analysis finished without a result.');
      } catch (error: any) {
        response.status(500).json({ success: false, error: error.message || 'PDF analysis failed.' });
      }
    });
    return id;
  }

  get(id: string): Job | undefined {
    this.prune();
    return this.jobs.get(id);
  }
}
