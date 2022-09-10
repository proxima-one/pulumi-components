import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import {
  ComputeResources,
  ComputeResourcesInput,
  HelmMeta,
  HelmOverride,
  Persistence,
} from "../../interfaces";
import * as utils from "../../utils";
import { merge } from "lodash";

export interface LokiInputs {
  namespace?: pulumi.Input<string>;
  helmOverride?: HelmOverride;
  /**
   * the retention time for recorded logs in hours
   * defaults to 7 days
   */
  retentionHours?: number;
  /**
   * Enable systemd-journal support.
   * https://grafana.com/docs/loki/latest/clients/promtail/configuration/#journal
   */
  scrapeSystemdJournal?: boolean;
  /**
   * Data persistence for loki's log database
   */
  persistence?: Persistence;
  /**
   * Pod resource request/limits
   */
  resources?: ComputeResources;
}

export interface LokiOutputs {
  meta: pulumi.Output<HelmMeta>;
  clusterUrl: pulumi.Output<string>;
  persistence: pulumi.Output<Persistence | undefined>;
}

/**
 * @noInheritDoc
 */
export class Loki extends pulumi.ComponentResource implements LokiOutputs {
  readonly meta: pulumi.Output<HelmMeta>;
  readonly clusterUrl: pulumi.Output<string>;
  readonly persistence: pulumi.Output<Persistence | undefined>;

  constructor(
    name: string,
    args: LokiInputs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("proxima-k8s:Loki", name, args, opts);

    this.persistence = pulumi.output(args?.persistence);

    this.clusterUrl = pulumi.output("http://loki:3100");

    this.meta = pulumi.output<HelmMeta>({
      chart: "loki-stack",
      version: args.helmOverride?.version ?? "2.8.0",
      repo: "https://grafana.github.io/helm-charts",
    });

    const loki = new k8s.helm.v3.Release(
      name,
      {
        namespace: args.namespace,
        chart: this.meta.chart,
        version: this.meta.version,
        repositoryOpts: {
          repo: this.meta.repo,
        },
        //transformations: [utils.removeHelmTests()],
        values: merge(
          {},
          {
            loki: {
              persistence: args.persistence
                ? {
                    enabled: args.persistence.enabled,
                    size: pulumi.interpolate`${args.persistence.sizeGB}Gi`,
                    storageClassName: args.persistence.storageClass,
                  }
                : { enabled: false },
              readinessProbe: {
                initialDelaySeconds: 10,
              },
              resources: args.resources,
              config: {
                table_manager: {
                  retention_deletes_enabled: true,
                  retention_period: pulumi.interpolate`${
                    args.retentionHours || 168
                  }h`,
                },
                schema_config: {
                  configs: [
                    {
                      from: "2018-04-15",
                      store: "boltdb",
                      object_store: "filesystem",
                      schema: "v9",
                      index: {
                        prefix: "index_",
                        period: pulumi.interpolate`${
                          args.retentionHours || 168
                        }h`,
                      },
                    },
                  ],
                },
                storage_config: {
                  boltdb: {
                    directory: "/data/loki/index",
                  },
                  filesystem: {
                    directory: "/data/loki/chunks",
                  },
                },
              },
            },
            promtail: args.scrapeSystemdJournal && {
              extraScrapeConfigs: [
                {
                  job_name: "journal",
                  journal: {
                    path: "/var/log/journal",
                    max_age: "12h",
                    labels: {
                      job: "systemd-journal",
                    },
                  },
                  relabel_configs: [
                    {
                      source_labels: ["__journal__systemd_unit"],
                      target_label: "unit",
                    },
                    {
                      source_labels: ["__journal__hostname"],
                      target_label: "hostname",
                    },
                  ],
                },
              ],
              extraVolumes: [
                {
                  name: "journal",
                  hostPath: {
                    path: "/var/log/journal",
                  },
                },
              ],
              extraVolumeMounts: [
                {
                  name: "journal",
                  mountPath: "/var/log/journal",
                  readOnly: true,
                },
              ],
            },
          },
          args.helmOverride?.values
        ),
      },
      { parent: this }
    );
  }
}
