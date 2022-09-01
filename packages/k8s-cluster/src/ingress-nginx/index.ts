import * as pulumi from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import * as abstractions from '../abstractions';
import {Output} from "@pulumi/pulumi";
import {merge} from 'lodash';

export interface IngressNginxControllerInputs {
  namespace?: pulumi.Input<string>;
  helmOverride?: abstractions.HelmOverride;
}

export interface IngressNginxControllerOutputs {
  meta: pulumi.Output<abstractions.HelmMeta>;
}

/**
 * @noInheritDoc
 */
export class IngressNginxController extends pulumi.ComponentResource implements IngressNginxControllerOutputs {
  readonly meta: pulumi.Output<abstractions.HelmMeta>;

  constructor(name: string, args: IngressNginxControllerInputs, opts?: pulumi.ComponentResourceOptions) {
    super('proxima-k8s:IngressNginxController', name, args, opts);

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
  }
}
