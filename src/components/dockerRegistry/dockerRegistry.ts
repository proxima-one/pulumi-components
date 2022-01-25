import * as pulumi from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';

/**
 * Creates k8s resources (v1/Secret) to ensure docker registry is accessibly within given namespaces
 */
export class DockerRegistry extends pulumi.ComponentResource {
  public readonly secrets: pulumi.Output<DockerRegistrySecret[]>;

  public constructor(
    name: string,
    args: DockerRegistryArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('proxima-k8s:DockerRegistry', name, args, opts);

    const secrets: pulumi.Output<DockerRegistrySecret>[] = [];
    for (const [registryKey, registry] of Object.entries(args.registries)) {
      const dockerconfigjson = toDockerConfigJsonString(registry);
      if (!dockerconfigjson)
        throw new Error(`Invalid docker registry input for ${registryKey}`);

      for (const [nsKey, ns] of Object.entries(args.namespaces)) {
        const secret = new k8s.core.v1.Secret(
          `pull-secret-${nsKey}-${registryKey}`,
          {
            metadata: {
              namespace: ns.metadata.name,
            },
            data: {
              '.dockerconfigjson': dockerconfigjson,
            },
            type: "kubernetes.io/dockerconfigjson"
          },
          { parent: this }
        );

        secrets.push(secret.metadata.name.apply(name => {
          return {
            namespaceKey: nsKey,
            registryKey: registryKey,
            secretName: name,
          };
        }));
      }
    }

    this.secrets = pulumi.all(secrets);

    this.registerOutputs({
      secrets: this.secrets,
    });
  }

  public getSecret(nsKey: string, registryKey: string): pulumi.Output<string> {
    return this.secrets.apply(secrets => {
      const item = secrets.find(x => x.namespaceKey == nsKey && x.registryKey == registryKey);

      if (!item)
        throw new Error(`Docker Registry ${registryKey} secret not found in namespace ${nsKey}`);

      return item.secretName;
    })
  }
}

export interface DockerRegistryArgs {
  registries: Record<string, DockerRegistryInfo | string>;
  namespaces: Record<string, k8s.core.v1.Namespace>;
}

export interface DockerRegistryInfo {
  auths?: Record<string, DockerRegistryAuth>;
}

export interface DockerRegistryAuth {
  auth: { user: string; password: string } | string;
  email?: string;
}

export interface DockerRegistrySecret {
  namespaceKey: string;
  registryKey: string;
  secretName: string;
}

function toDockerConfigJsonString(
  dockerRegistry: DockerRegistryInfo | string
): string | undefined {
  if (typeof dockerRegistry == 'string') return dockerRegistry;

  if (dockerRegistry.auths !== undefined) {
    const encodedAuths: any = {};

    for (const [registry, auth] of Object.entries(dockerRegistry.auths)) {
      encodedAuths[registry] = {
        email: auth.email ?? "",
        auth:
          typeof auth.auth == 'string'
            ? auth.auth
            : Buffer.from(`${auth.auth.user}:${auth.auth.password}`).toString(
                'base64'
              ),
      };
    }

    return Buffer.from(JSON.stringify({
      auths: encodedAuths,
    }, null, 2)).toString(
      'base64'
    );
  }

  return undefined;
}
