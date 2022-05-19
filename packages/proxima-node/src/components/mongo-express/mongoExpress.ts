import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as helpers from "../../helpers";

import {
  Password,
  ResourceRequirements,
} from "../types";

export interface MongoExpressArgs {
  namespace: pulumi.Input<string>;
  resources?: ResourceRequirements;

  mongodbServer: pulumi.Input<string>;
  mongoAdminAuth: MongoExpressDbAuth;
  auth?: MongoExpressAuth;
  publicHost?: pulumi.Input<string>;
}

export interface MongoExpressDbAuth {
  username: string;
  password: pulumi.Input<string>;
}

export interface MongoExpressAuth {
  username: string;
  password: Password;
}

export class MongoExpress extends pulumi.ComponentResource {

  public readonly chart: k8s.helm.v3.Chart;

  public readonly resolvedPasswords: pulumi.Output<Record<string, string>>;
  public readonly username: string;
  public readonly password: pulumi.Output<string>;
  public readonly ingress?: k8s.networking.v1.Ingress;

  public constructor(
    name: string,
    args: MongoExpressArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("proxima-k8s:MongoExpress", name, args, opts);

    const passwords = new helpers.PasswordResolver(this);
    const auth: MongoExpressAuth = args.auth ?? {
      username: "mongo-express",
      password: {
        type: "random",
        name: `${name}-secret`,
      },
    };

    this.chart = new k8s.helm.v3.Chart(
      name,
      {
        fetchOpts: {
          repo: "https://cowboysysop.github.io/charts/",
        },
        chart: "mongo-express",
        version: "2.6.5",
        namespace: args.namespace,
        values: {
          service: {
            port: 80
          },
          mongodbServer: args.mongodbServer,
          mongodbEnableAdmin: true,
          mongodbAdminUsername: args.mongoAdminAuth.username,
          mongodbAdminPassword: args.mongoAdminAuth.password,
          basicAuthUsername: auth.username,
          basicAuthPassword: passwords.resolve(auth.password)
        },
      },
      { parent: this }
    );

    const svcName = `${name}-mongo-express`;

    if (args.publicHost) {
      this.ingress = new k8s.networking.v1.Ingress(
        `${name}`,
        {
          metadata: {
            namespace: args.namespace,
            annotations: helpers.ingressAnnotations({
              certIssuer: "letsencrypt",
              backendGrpc: true,
              sslRedirect: true,
              bodySize: "300m",
            }),
          },
          spec: helpers.ingressSpec({
            host: args.publicHost,
            path: "/",
            backend: {
              service: {
                name: svcName,
                port: 80,
              },
            },
            tls: {
              secretName: `${svcName}-tls`,
            },
          }),
        },
        { parent: this }
      );
    }

    this.resolvedPasswords = passwords.getResolvedPasswords();
    this.username = auth.username;
    this.password = passwords.resolve(auth.password);

    this.registerOutputs({
      username: this.username,
      password: this.password,
    });
  }
}
