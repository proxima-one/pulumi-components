import * as pulumi from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import * as abstractions from '@proxima-one/pulumi-k8s-cluster/src/abstractions';
import {Output} from "@pulumi/pulumi";
import {merge} from 'lodash';

export interface IngressNginxControllerInputs {
  namespace?: pulumi.Input<string>;
  helmOverride?: abstractions.HelmOverride;
}

export interface IngressNginxControllerOutputs {
  meta: pulumi.Output<abstractions.HelmMeta>;
  publicIP: pulumi.Output<string>;
}

/**
 * @noInheritDoc
 */
export class IngressNginxController extends pulumi.ComponentResource implements IngressNginxControllerOutputs {
  readonly meta: pulumi.Output<abstractions.HelmMeta>;
  readonly publicIP: pulumi.Output<string>;

  constructor(name: string, args: IngressNginxControllerInputs, opts?: pulumi.ComponentResourceOptions) {
    super('proxima:IngressNginxController', name, args, opts);

    this.meta = pulumi.output<abstractions.HelmMeta>({
      chart: 'ingress-nginx',
      version: args.helmOverride?.version ?? '4.0.17',
      repo: 'https://kubernetes.github.io/ingress-nginx',
    });

    const chart = new k8s.helm.v3.Chart(name, {
      namespace: args.namespace,
      chart: this.meta.chart,
      version: this.meta.version,
      fetchOpts: {
        repo: this.meta.repo,
      },
      //transformations: [removeHelmTests()],
      values: merge({}, {
        controller: {
          publishService: {
            enabled: true,
          },
          admissionWebhooks: {
            enabled: false,
            //timeoutSeconds: 30
          }
        },
      }, args.helmOverride?.values),
    }, {parent: this,});

    const frontend = Output.create(args.namespace).apply(
      ns => chart.getResourceProperty(
        "v1/Service",
        ns ?? "default",
        `${name}-ingress-nginx-controller`,
        "status"
      ));
    const ingress = frontend.apply(x => x.loadBalancer.ingress[0]);

    this.publicIP = ingress.apply(x => x.ip ?? x.hostname);
  }
}
