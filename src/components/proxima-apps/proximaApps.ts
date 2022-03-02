import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { JsonObject, ResourceRequirements } from "../types";
import { ProximaApp, ProximaAppMetadata } from "./proximaApp";

export class ProximaApps extends pulumi.ComponentResource {
  public constructor(
    name: string,
    args: ProximaAppsArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("proxima-k8s:ProximaApps", name, args, opts);

    for (const app of args.apps) {
      new ProximaApp(
        app.id.replace(".", "-").toLowerCase(),
        {
          configs: [args.userConfig, args.clusterConfig],
          metadata: app,
          namespace: args.namespace,
          imagePullSecrets: args.imagePullSecrets,
          resources: app.hostHints?.resources,
        },
        { parent: this }
      );
    }

    this.registerOutputs();
  }
}

export interface ProximaAppsArgs {
  namespace: k8s.core.v1.Namespace;
  imagePullSecrets?: pulumi.Input<string[]>;
  userConfig: JsonObject;
  clusterConfig: pulumi.Input<JsonObject>;
  apps: (ProximaAppMetadata & { hostHints?: AppHostHints })[];
}

export interface AppHostHints {
  resources?: ResourceRequirements;
}

function merge<T>(lookups: Record<string, T>[]): Record<string, T> {
  const result: Record<string, T> = {};

  for (const lookup of lookups)
    for (const [key, value] of Object.entries(lookup)) {
      if (result[key])
        throw new Error(`Can't merge objects: duplicate key ${key}`);

      result[key] = value;
    }

  return result;
}
