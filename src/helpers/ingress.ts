import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

export function ingressSpec(
  args: SimpleIngressArgs
): k8s.networking.v1.IngressArgs["spec"] {
  const port: any = {};
  if (typeof args.backend.service.port == "string")
    port.name = args.backend.service.port;
  else port.number = args.backend.service.port;

  return {
    rules: [
      {
        host: args.host,
        http: {
          paths: [
            {
              path: args.path,
              pathType: "ImplementationSpecific",
              backend: {
                service: {
                  name: args.backend.service.name,
                  port: port,
                },
              },
            },
          ],
        },
      },
    ],
    tls: args.tls
      ? [
          {
            secretName: args.tls.secretName,
            hosts: [args.host],
          },
        ]
      : [],
  };
}

export interface SimpleIngressArgs {
  host: string;
  path: string;
  backend: {
    service: {
      name: pulumi.Input<string>;
      port: number | string;
    };
  };
  tls?: {
    secretName: pulumi.Input<string>;
  };
}

export function ingressAnnotations(
  args: SimpleIngressAnnotations
): Record<string, string> {
  const res: Record<string, string> = {
    "kubernetes.io/ingress.class": "nginx",
  };
  if (args.backendHttps)
    res["nginx.ingress.kubernetes.io/backend-protocol"] = "HTTPS";

  if (args.bodySize) {
    res["nginx.ingress.kubernetes.io/proxy-body-size"] = args.bodySize;
  }
  return res;
}

export interface SimpleIngressAnnotations {
  backendHttps?: boolean;
  bodySize?: string;
}
