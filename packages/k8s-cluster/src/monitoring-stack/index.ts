import * as pulumi from '@pulumi/pulumi';
import * as grafana from '@proxima-one/pulumi-k8s-cluster/src/grafana';
import * as prometheus from '@proxima-one/pulumi-k8s-cluster/src/prometheus';
import * as loki from '@proxima-one/pulumi-k8s-cluster/src/loki';

export interface MonitoringStackInputs {
  namespace?: pulumi.Input<string>;

  grafana?: grafana.GrafanaInputs;
  loki?: loki.LokiInputs;
  uprometheus?: prometheus.PrometheusInputs;
}

export interface MonitoringStackOutputs {
  grafana?: grafana.GrafanaOutputs;
  loki?: loki.LokiOutputs;
  uprometheus?: prometheus.UPrometheusOutputs;
}

export class MonitoringStack extends pulumi.ComponentResource implements MonitoringStackOutputs {
  readonly grafana?: grafana.GrafanaOutputs;
  readonly prometheus?: prometheus.UPrometheusOutputs;
  readonly loki?: loki.LokiOutputs;
  readonly uprometheus?: prometheus.UPrometheusOutputs;

  constructor(name: string, args: MonitoringStackInputs, opts?: pulumi.ComponentResourceOptions) {
    super('proxima:MonitoringStack', name, args, opts);

    const defaults_ = {
      grafana: {
        enabled: false,
        provider: args.provider,
        namespace: args.namespace,
        datasources: [
          {
            name: 'prometheus',
            type: 'prometheus',
            url: `http://${name}-prometheus-server`,
          },
          {
            name: 'loki',
            type: 'loki',
            url: `http://${name}-loki:3100`,
          },
        ],
        persistence: {
          enabled: true,
          sizeGB: 1,
        },
      },
      loki: {
        enabled: true,
        provider: args.provider,
        namespace: args.namespace,
        persistence: {
          enabled: true,
          sizeGB: 10,
        },
      },
      prometheus: {
        enabled: true,
        provider: args.provider,
        namespace: args.namespace,
        persistence: {
          enabled: true,
          sizeGB: 10,
        },
      },
    };

    if (args.uprometheus) {
      this.uprometheus = new prometheus.UPrometheus(`${name}-prometheus`, args.uprometheus, {parent: this});
    }

    if (args.grafana) {
      /*
      args.grafana?.dashboards?.forEach((dashboard: any) => {
        if (dashboard?.gnetId !== undefined && dashboard?.datasource === undefined) {
          dashboard.datasource = 'prometheus';
        }
      });
      */
      this.grafana = new grafana.Grafana(`${name}-grafana`, args.grafana, {parent: this});
    }

    if (args.loki) {
      this.loki = new loki.Loki(`${name}-loki`, args.loki, {parent: this});
    }

  }
}
