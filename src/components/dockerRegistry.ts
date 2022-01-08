import * as pulumi from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';

/**
 * Creates k8s resources (v1/Secret) to ensure docker registry is accessibly within given namespaces
 */
export class DockerRegistry extends pulumi.ComponentResource {
  public constructor(
    name: string,
    args: DockerRegistryArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('proxima-k8s:DockerRegistry', name, args, opts);

    for (const [registryKey, registry] of Object.entries(args.registries)) {
      const dockerconfigjson = toDockerConfigJsonString(registry);
      if (!dockerconfigjson)
        throw new Error(`Invalid docker registry input for ${registryKey}`);

      for (const [nsKey, ns] of Object.entries(args.namespaces)) {
        new k8s.core.v1.Secret(
          `pull-secret-${nsKey}-${registryKey}`,
          {
            metadata: {
              namespace: ns.metadata.name,
            },
            data: {
              '.dockerconfigjson': dockerconfigjson,
            },
          },
          { parent: this }
        );
      }

      this.registerOutputs();
    }
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

function toDockerConfigJsonString(
  dockerRegistry: DockerRegistryInfo | string
): string | undefined {
  if (typeof dockerRegistry == 'string') return dockerRegistry;

  if (dockerRegistry.auths !== undefined) {
    const encodedAuths: any = {};

    for (const [registry, auth] of Object.entries(dockerRegistry.auths)) {
      encodedAuths[registry] = {
        email: auth.email,
        auth:
          typeof auth.auth == 'string'
            ? auth.auth
            : Buffer.from(`${auth.auth.user}:${auth.auth.password}`).toString(
                'base64'
              ),
      };
    }

    return Buffer.from(JSON.stringify(encodedAuths, null, 2)).toString(
      'base64'
    );
  }

  return undefined;
}
