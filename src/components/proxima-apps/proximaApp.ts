import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as _ from "lodash";
import * as yaml from "js-yaml";
import { JsonObject, Resources } from "../types";

/**
 * Installs Proxima App with given metadata
 */
export class ProximaApp extends pulumi.ComponentResource {
  public readonly config: k8s.core.v1.ConfigMap;
  public readonly deployment: k8s.apps.v1.Deployment;

  public readonly appArgs: pulumi.Output<string[]>;
  public readonly envVars: pulumi.Output<{ name: string; value: string }[]>;

  public constructor(
    name: string,
    args: ProximaAppArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("proxima-k8s:ProximaApp", name, args, opts);

    const resolveConfigs = () => {
      if (args.configs) return pulumi.Output.create(args.configs);

      if (args.config)
        return pulumi.Output.create(args.config).apply((x) => [x]);

      return pulumi.Output.create([]);
    };

    const mergedConfig = resolveConfigs().apply((x) => _.merge({}, ...x));

    this.config = new k8s.core.v1.ConfigMap(
      name,
      {
        metadata: {
          namespace: args.namespace.metadata.name,
        },
        data: {
          "config.yml": mergedConfig.apply((x) => yaml.dump(x, { indent: 2 })),
        },
      },
      { parent: this }
    );

    const metadata = pulumi.Output.create(args.metadata);
    const labels = {
      app: "proxima-app", //metadata.id,
    };

    this.envVars = metadata.apply((meta) => {
      const vars = [
        {
          name: "NODE_EXTRA_CA_CERTS",
          value: "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt",
        },
      ];

      if (args.trace)
        vars.push({
          name: "PROXIMA_TRACE_ENABLED",
          value: "1",
        });

      if (args.streamEndOffsetTolerance)
        vars.push({
          name: "STREAM_END_OFFSET_TOLERANCE",
          value: args.streamEndOffsetTolerance,
        });

      return vars;
    });

    this.appArgs = metadata.apply((meta) => {
      const args: string[] = [];

      //little hack
      const streamingServerSyntax = meta.executable.image.startsWith(
        "quay.io/proxima.one/streaming-server:"
      );
      if (streamingServerSyntax) args.push("process", "start");
      else args.push("app", "start");

      args.push(meta.executable.appName);
      args.push("--id", meta.id);

      args.push("--target-db", meta.env.db);
      args.push("--source-db", meta.env.sourceDb ?? meta.env.db);

      const sourceStreams =
        meta.env.sourceStreams ??
        (meta.env.sourceStream ? [meta.env.sourceStream] : []);
      if (sourceStreams.length > 0)
        args.push("--source-streams", sourceStreams.join(","));

      if (meta.env.namespace) args.push("--namespace", meta.env.namespace);

      if (streamingServerSyntax) args.push("--process-args");
      else args.push("--app-args");

      args.push(JSON.stringify(meta.args ?? {}));
      return args;
    });

    this.deployment = new k8s.apps.v1.Deployment(
      name,
      {
        metadata: {
          namespace: args.namespace.metadata.name,
          labels: labels,
        },
        spec: {
          selector: {
            matchLabels: labels,
          },
          template: {
            metadata: {
              labels: labels,
            },
            spec: {
              restartPolicy: "Always",
              imagePullSecrets: args.imagePullSecrets
                ? pulumi.Output.create(args.imagePullSecrets).apply((x) =>
                    x.map((y) => {
                      return { name: y };
                    })
                  )
                : undefined,
              volumes: [
                {
                  name: "config",
                  configMap: {
                    name: this.config.metadata.name,
                  },
                },
              ],
              containers: [
                {
                  image: metadata.executable.image,
                  name: "proxima-app",
                  env: this.envVars,
                  args: this.appArgs,
                  volumeMounts: [
                    {
                      name: "config",
                      mountPath: "/app/config.yml",
                      subPath: "config.yml",
                    },
                  ],
                  resources: (args.resources as any) ?? {
                    requests: {
                      memory: "300Mi",
                      cpu: "50m",
                    },
                    limits: {
                      memory: "2Gi",
                      cpu: "1000m",
                    },
                  },
                },
              ],
            },
          },
        },
      },
      { parent: this, dependsOn: this.config }
    );
    this.registerOutputs();
  }
}

export interface ProximaAppArgs {
  namespace: k8s.core.v1.Namespace;
  metadata: pulumi.Input<ProximaAppMetadata>;
  trace?: boolean;
  streamEndOffsetTolerance?: string;
  config?: pulumi.Input<JsonObject>;
  configs?: pulumi.Input<JsonObject>[];
  imagePullSecrets?: pulumi.Input<string[]>;
  resources?: Resources;
}

export interface ProximaAppMetadata {
  id: string;
  executable: AppExecutable;

  env: ProximaAppEnvironment;
  args?: JsonObject;
  // additional files??
}

export interface ProximaAppEnvironment {
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
