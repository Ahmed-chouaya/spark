# agent-relay Specification

## Purpose
Defines how the companion learns about live host-agent activity: the relay the host invokes,
the local channel it delivers over, and the installation of the host's hooks.

## Requirements

### Requirement: The host invokes a relay

The host agent SHALL invoke a relay with each of its hook payloads, and the relay SHALL
deliver that payload to the companion and exit.

#### Scenario: A hook fires

- **WHEN** the host agent invokes the relay with a payload
- **THEN** the payload reaches the companion and the relay exits

#### Scenario: Several hooks in sequence

- **WHEN** the host invokes the relay repeatedly
- **THEN** every payload is delivered and every invocation exits

### Requirement: The relay translates nothing

The relay SHALL deliver the host's payload unmodified. Converting a host's event names into
the canonical vocabulary SHALL NOT happen in the relay.

#### Scenario: Payload arrives as the host wrote it

- **WHEN** the companion receives a payload through the relay
- **THEN** the payload is the host's own, unaltered by the relay

#### Scenario: One place interprets a host

- **WHEN** a host's event names are converted into the canonical vocabulary
- **THEN** that conversion happens in exactly one place in this codebase

### Requirement: The relay never blocks the host

The relay SHALL NOT wait for the companion to acknowledge a delivery, and SHALL NOT wait for
any response. It SHALL exit once the payload has been delivered.

This guarantee belongs to the relay program specifically. Where a second program is
installed as a hook in order to carry a decision back, that program is the one that waits,
and the guarantee this requirement states is not extended to it — it is stated separately,
in the capability that governs the wait, so that weakening it is a visible act rather than
a drift.

#### Scenario: Companion is slow

- **WHEN** the companion takes a long time to read what was delivered
- **THEN** the relay does not wait for it

#### Scenario: Relay waits for nothing

- **WHEN** the relay has delivered a payload
- **THEN** it exits without waiting for a reply, an acknowledgement, or a timeout

#### Scenario: The relay is unchanged by a second program existing

- **WHEN** a second program is installed as a hook alongside the relay
- **THEN** the relay's own behaviour and its own sources are unaffected, and the relay still exits without waiting

### Requirement: An unreachable companion never harms the host

If the companion is not running, the relay SHALL still exit successfully and the host agent
SHALL continue unaffected.

#### Scenario: Nothing is listening

- **WHEN** the relay is invoked and no companion is running
- **THEN** the relay exits successfully and the host agent proceeds

#### Scenario: Companion is not yet installed

- **WHEN** the relay is invoked before the companion has ever run
- **THEN** the relay exits successfully rather than failing the host's operation

#### Scenario: The host's own configuration is never invalidated

- **WHEN** the companion is unavailable
- **THEN** the host agent behaves exactly as it would with no companion installed

### Requirement: The relay has no runtime dependency

The relay SHALL run without requiring any language runtime, interpreter, or package
installation beyond the relay program itself.

#### Scenario: Clean machine

- **WHEN** the relay runs on a machine that has no project dependencies installed
- **THEN** it still delivers and exits successfully

### Requirement: Only the local user may connect

The channel the relay delivers over SHALL be reachable only by processes running as the
user who owns the companion.

#### Scenario: Another user on the same machine

- **WHEN** a process running as a different user attempts to connect to the channel
- **THEN** the connection is refused

#### Scenario: Path traversal is not a route in

- **WHEN** a different user's process attempts to reach the channel by naming a path
- **THEN** it is refused for the same reason

### Requirement: A stale channel does not block the companion

Where the channel cannot be created because a previous one is left over, the companion
SHALL replace it rather than fail.

#### Scenario: Channel left behind by a crash

- **WHEN** a channel already exists from a previous run
- **THEN** the companion replaces it and becomes available

#### Scenario: Companion starts after an unclean exit

- **WHEN** the companion starts and finds a channel it does not own
- **THEN** it takes ownership rather than refusing to start

### Requirement: The companion is reachable at a known address

The relay SHALL reach the companion at a single documented address that is derived from the
owning user, and that address SHALL NOT be chosen at runtime by one of the participants.

#### Scenario: Relay finds the companion

- **WHEN** the relay is invoked
- **THEN** it reaches the companion without being told where the companion is

#### Scenario: The address is per-user

- **WHEN** two users each run a companion
- **THEN** each companion is reached at a different address

### Requirement: Hooks are installed deliberately

Installing the host's hooks SHALL require an explicit act, SHALL back up the host's existing
configuration before changing it, and SHALL show the proposed change before writing
anything.

#### Scenario: Nothing changes without being asked

- **WHEN** the companion is installed for the first time
- **THEN** no hook is installed until the user asks for it

#### Scenario: The proposal is shown first

- **WHEN** the user is about to install hooks
- **THEN** they are shown the change that would be made, before it is made

#### Scenario: Declining changes nothing

- **WHEN** the user declines the proposed change
- **THEN** the host's configuration file is exactly as it was

#### Scenario: The previous configuration is recoverable

- **WHEN** hooks are installed
- **THEN** the configuration as it was beforehand is kept somewhere recoverable

#### Scenario: Existing hooks are preserved

- **WHEN** the host's configuration already contains hooks the companion did not add
- **THEN** installing the companion's hooks leaves them in place

#### Scenario: Installing twice does not double up

- **WHEN** hooks are installed more than once
- **THEN** the host's configuration contains one copy of each companion hook

### Requirement: Sessions arrive without being supplied

A session started in a host agent SHALL reach the companion's state selection through the
relay, without a caller providing it.

#### Scenario: A session starts in a terminal

- **WHEN** the user starts work in a host agent
- **THEN** the companion knows about that session without being told about it

#### Scenario: The reduction still decides

- **WHEN** sessions arrive from the host
- **THEN** which state is rendered is still decided by the reduction, not by the transport

### Requirement: The relay is not where a host is interpreted

Adding support for a second host agent SHALL NOT require a change to the relay.

#### Scenario: A second host agent

- **WHEN** a second host agent is given support
- **THEN** the relay is unchanged

### Requirement: An unusable payload does not harm the host

A payload the relay cannot use SHALL NOT cause the relay to fail the host's operation.

#### Scenario: Payload is not what was expected

- **WHEN** the relay receives something it cannot deliver
- **THEN** it exits successfully

#### Scenario: The companion receives nothing unusable

- **WHEN** the relay cannot deliver something
- **THEN** nothing reaches the companion's state selection from it
