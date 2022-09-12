import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { HelmMeta, HelmOverride } from "../../interfaces";
import { merge } from "lodash";

export interface IngressNginxControllerInputs {
  namespace?: pulumi.Input<string>;
  helmOverride?: HelmOverride;
}

export interface IngressNginxControllerOutputs {
  publicIP: pulumi.Output<string>;
}

/**
 * @noInheritDoc
 */
export class IngressNginxController
  extends pulumi.ComponentResource
  implements IngressNginxControllerOutputs
{
  readonly publicIP: pulumi.Output<string>;

  constructor(
    name: string,
    args: IngressNginxControllerInputs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("proxima-k8s:IngressNginxController", name, args, opts);

    const meta = pulumi.output<HelmMeta>({
      chart: "ingress-nginx",
      version: args.helmOverride?.version ?? "4.0.17",
      repo: "https://kubernetes.github.io/ingress-nginx",
    });

    const chart = new k8s.helm.v3.Chart(
      name,
      {
        namespace: args.namespace,
        chart: meta.chart,
        version: meta.version,
        fetchOpts: {
          repo: meta.repo,
        },
        //transformations: [removeHelmTests()],
        values: merge(
          {},
          {
            controller: {
              publishService: {
                enabled: true,
              },
              admissionWebhooks: {
                enabled: false,
                //timeoutSeconds: 30
              },
            },
          },
          args.helmOverride?.values
        ),
      },
      { parent: this }
    );

    const frontend = pulumi
      .output(args.namespace)
      .apply((ns) =>
        chart.getResourceProperty(
          "v1/Service",
          ns ?? "default",
          `${name}-ingress-nginx-controller`,
          "status"
        )
      );
    const ingress = frontend.apply((x) => x.loadBalancer.ingress[0]);

    this.publicIP = ingress.apply((x) => x.ip ?? x.hostname);
  }
}