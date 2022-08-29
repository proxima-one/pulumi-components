import * as pulumi from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import * as abstractions from '@proxima-one/pulumi-k8s-cluster/src/abstractions';
import {removeHelmTests} from 'k8s-cluster/src/utils/helm';

export interface LokiInputs {
  namespace?: pulumi.Input<string>;
  /**
   * the helm chart version
   */
  version?: string;
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
  persistence?: abstractions.Persistence;
  /**
   * Pod resource request/limits
   */
  resources?: abstractions.ComputeResources;
}

export interface LokiOutputs {
  meta: pulumi.Output<abstractions.HelmMeta>;
  clusterUrl: pulumi.Output<string>;
  persistence: pulumi.Output<abstractions.Persistence | undefined>;
}

/**
 * @noInheritDoc
 */
export class Loki extends pulumi.ComponentResource implements LokiOutputs {
  readonly meta: pulumi.Output<abstractions.HelmMeta>;
  readonly clusterUrl: pulumi.Output<string>;
  readonly persistence: pulumi.Output<abstractions.Persistence | undefined>;

  constructor(name: string, args: LokiInputs, opts?: pulumi.ComponentResourceOptions) {
    super('proxima:Loki', name, args, opts);

    this.persistence = pulumi.output(args?.persistence);

    this.clusterUrl = pulumi.output('http://loki:3100');

    this.meta = pulumi.output<abstractions.HelmMeta>({
      chart: 'loki-stack',
      version: args.version ?? '2.1.0',
      repo: 'https://grafana.github.io/loki/charts',
    });

    const loki = new k8s.helm.v3.Chart(name, {
      namespace: args.namespace,
      chart: this.meta.chart,
      version: this.meta.version,
      fetchOpts: {
        repo: this.meta.repo,
      },
      transformations: [removeHelmTests()],
      values: {
        loki: {
          persistence: args.persistence ? {
            enabled: args.persistence.enabled,
            size: pulumi.interpolate`${args.persistence.sizeGB}Gi`,
            storageClassName: args.persistence.storageClass,
          } : {enabled: false},
          readinessProbe: {
            initialDelaySeconds: 10,
          },
          resources: args.resources,
          config: {
            table_manager: {
              retention_deletes_enabled: true,
              retention_period: pulumi.interpolate`${args.retentionHours || 168}h`,
            },
            schema_config: {
              configs: [
                {
                  from: '2018-04-15',
                  store: 'boltdb',
                  object_store: 'filesystem',
                  schema: 'v9',
                  index: {
                    prefix: 'index_',
                    period: '168h',
                  },
                },
              ],
            },
            storage_config: {
              boltdb: {
                directory: '/data/loki/index',
              },
              filesystem: {
                directory: '/data/loki/chunks',
              },
            },
          },
        },
        promtail: args.scrapeSystemdJournal && {
          extraScrapeConfigs: [
            {
              job_name: 'journal',
              journal: {
                path: '/var/log/journal',
                max_age: '12h',
                labels: {
                  job: 'systemd-journal',
                },
              },
              relabel_configs: [
                {
                  source_labels: ['__journal__systemd_unit'],
                  target_label: 'unit',
                },
                {
                  source_labels: ['__journal__hostname'],
                  target_label: 'hostname',
                },
              ],
            },
          ],
          extraVolumes: [
            {
              name: 'journal',
              hostPath: {
                path: '/var/log/journal',
              },
            },
          ],
          extraVolumeMounts: [
            {
              name: 'journal',
              mountPath: '/var/log/journal',
              readOnly: true,
            },
          ],
        },
      },
    }, {parent: this,});
  }
}
