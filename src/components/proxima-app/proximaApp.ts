import * as pulumi from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { JsonObject } from "../types";

/**
 * Installs minio/operator helm chart
 */
export class StreamingApp extends pulumi.ComponentResource {

  public constructor(
    name: string,
    args: StreamingAppArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('proxima-k8s:StreamingApp', name, args, opts);

    this.registerOutputs();
  }
}

export interface StreamingAppArgs {
  namespace: k8s.core.v1.Namespace;
  metadata: pulumi.Input<StreamingAppMetadata>;
  config?: pulumi.Input<JsonObject>;
  configs?: pulumi.Input<JsonObject>[];
}

export interface StreamingAppMetadata {
  id: string;
  executable: AppExecutable;

  env: StreamingAppEnvironment;
  trace?: boolean;
  args?: JsonObject;

  // additional files??
}

export interface StreamingAppEnvironment {
  db: string;
  sourceStreams?: string[];
  sourceStream?: string;
  sourceDb?: string; // if different
  namespace?: string;
}

export type AppExecutable = DockerAppExecutable;

export interface DockerAppExecutable {
  type: "docker";

  image: string;
  appName: string;
}
