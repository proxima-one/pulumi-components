import * as pulumi from '@pulumi/pulumi';
import * as grafana from '@proxima-one/pulumi-k8s-cluster/src/grafana';
import * as prometheus from '@proxima-one/pulumi-k8s-cluster/src/prometheus';
import * as loki from '@proxima-one/pulumi-k8s-cluster/src/loki';

export interface MonitoringStackInputs {
  grafana?: grafana.GrafanaInputs;
  loki?: loki.LokiInputs;
  prometheus?: prometheus.PrometheusInputs;
}

export interface MonitoringStackOutputs {
  grafana?: grafana.GrafanaOutputs;
  loki?: loki.LokiOutputs;
  prometheus?: prometheus.PrometheusOutputs;
}

export class MonitoringStack extends pulumi.ComponentResource implements MonitoringStackOutputs {
  readonly grafana?: grafana.GrafanaOutputs;
  readonly loki?: loki.LokiOutputs;
  readonly prometheus?: prometheus.PrometheusOutputs;

  constructor(name: string, args: MonitoringStackInputs, opts?: pulumi.ComponentResourceOptions) {
    super('proxima:MonitoringStack', name, args, opts);

    if (args.prometheus) {
      this.prometheus = new prometheus.Prometheus(`${name}-prometheus`, args.prometheus, {parent: this});
    }

    if (args.grafana) {
      this.grafana = new grafana.Grafana(`${name}-grafana`, args.grafana, {parent: this});
    }

    if (args.loki) {
      this.loki = new loki.Loki(`${name}-loki`, args.loki, {parent: this});
    }
  }
}
