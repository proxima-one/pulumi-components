import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { HelmMeta, HelmOverride } from "../../interfaces";
import { merge } from "lodash";

export interface IngressNginxControllerArgs {
  namespace?: pulumi.Input<string>;
  helmOverride?: HelmOverride;
}

/**
 * @noInheritDoc
 */
export class IngressNginxController extends pulumi.ComponentResource {
  public readonly publicIP: pulumi.Output<string>;

  public constructor(
    name: string,
    args: IngressNginxControllerArgs,
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
              metrics: {
                enabled: true,
                service: {
                  annotations: {
                    "prometheus.io/scrape": "true",
                    "prometheus.io/port": "10254",
                  },
                },
              },
              publishService: {
                enabled: true,
              },
              // stats: true,
              admissionWebhooks: {
                enabled: false,
                //timeoutSeconds: 30
              },
            },
          },
          args.helmOverride?.values
        ),
      },
      {parent: this}
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
