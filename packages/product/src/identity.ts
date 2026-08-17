import type { ProductProfile } from "./profile"

export type Channel = "dev" | "prod"

export type ChannelIdentity = {
  channel: Channel
  displayName: string
  directoryName: string
  appId: string
  protocol: string
}

export function deriveChannelIdentity(profile: ProductProfile, channel: Channel): ChannelIdentity {
  if (channel === "prod") return { channel, ...profile.identity }
  return {
    channel,
    displayName: `${profile.identity.displayName} Dev`,
    directoryName: `${profile.identity.directoryName}-dev`,
    appId: `${profile.identity.appId}.dev`,
    protocol: `${profile.identity.protocol}-dev`,
  }
}
