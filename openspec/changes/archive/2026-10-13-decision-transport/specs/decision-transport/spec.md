# Spec Delta

## Purpose

The blocking half of the approval round trip: how a pending request reaches the companion,
how long the host waits for an answer, what the host is told when there is none, and the
invariant that governs every path through the wait.

## ADDED Requirements

### Requirement: A request is announced and then awaited

Where the host has asked something the companion can answer, the companion SHALL be able
to receive the request, present it, and deliver the answer back to the request that asked.

#### Scenario: The round trip completes

- **WHEN** the user answers a decision the surface is offering
- **THEN** the host is told, and the tool the request was made for proceeds or is refused as the answer says

#### Scenario: A request the user does not answer

- **WHEN** the request is presented and no answer arrives
- **THEN** the host is released without a decision, and is in the state it would have been in had the companion not been installed

### Requirement: Nothing the companion does can delay the host indefinitely

The wait SHALL be bounded, and the bound SHALL be enforced by the program that is making
the host wait rather than by the companion.

#### Scenario: The companion never answers

- **WHEN** the request is announced and no answer arrives
- **THEN** the wait ends at its deadline and the host is released

#### Scenario: The bound is the waiter's own

- **WHEN** the wait reaches its deadline
- **THEN** the host is released whether or not the companion is still running, still reading, or still thinking, because the process making the host wait is the one that stops waiting

#### Scenario: A deadline is not a decision

- **WHEN** the wait ends without an answer
- **THEN** the host is given no decision at all, and not a refusal, because a timeout that refuses is indistinguishable from the user having said no

### Requirement: Every failure of the wait leaves the host as it was

If the companion is not running, the channel cannot be opened, the payload cannot be read,
or the exchange fails at any point, the host SHALL be told nothing and released.

#### Scenario: No companion is running

- **WHEN** the wait is attempted and the companion is not running
- **THEN** the host is released without waiting for a deadline it can see coming

#### Scenario: The channel cannot be opened

- **WHEN** the channel cannot be opened for any reason
- **THEN** the host is told nothing and released

#### Scenario: The payload cannot be read

- **WHEN** standard input cannot be read, or carries nothing usable
- **THEN** the host is told nothing and released

#### Scenario: The exchange fails part way

- **WHEN** the request was announced and the exchange then fails
- **THEN** the host is told nothing and released, rather than being told a decision that was never made

#### Scenario: The exit is always a success

- **WHEN** any of the above happens
- **THEN** the program exits successfully, because an exit status the host reads as failure is itself a way of harming it

### Requirement: The wait cannot outlive the user who asked for it

The wait SHALL end when the host stops waiting, and SHALL NOT be resumed by a late answer.

#### Scenario: The host stopped waiting first

- **WHEN** the deadline has passed and an answer arrives afterwards
- **THEN** the answer is discarded, and nothing is printed to the host

#### Scenario: An answer for a request that is no longer waiting

- **WHEN** an answer arrives naming a request that has already been resolved or abandoned
- **THEN** it is refused, and no other request is answered in its place

### Requirement: The reply is the host's own format

The answer SHALL be delivered in the format the host reads for a permission decision, and
SHALL name nothing the host does not understand.

#### Scenario: Allow and Deny are both expressible

- **WHEN** the user answers either way
- **THEN** the host receives a decision in its own documented shape

#### Scenario: Nothing else is offered

- **WHEN** the reply is produced
- **THEN** it carries a decision and nothing else, because a reply carrying extra instructions is a channel the host was not expecting

### Requirement: The waiting program carries no product vocabulary

The program that makes the host wait SHALL NOT name the companion's states, the host's
event names, or the surface's own concepts.

#### Scenario: No second implementation of the host's vocabulary

- **WHEN** the waiting program's source is read
- **THEN** it contains no host event name and no mascot state, so the host's vocabulary cannot come to exist in a second place

#### Scenario: It is still a program with no runtime dependency

- **WHEN** the waiting program is built
- **THEN** it links nothing that has to be installed, for the same reason the relay does: the host invokes it as a bare command

### Requirement: Installing the wait is deliberate

The blocking hook SHALL be installed only on explicit request, through the same consent
path as every other hook, and SHALL be removable independently.

#### Scenario: Nothing is written without a request

- **WHEN** the blocking hook is not explicitly requested
- **THEN** the host's configuration is untouched

#### Scenario: Both hooks are visible before either is written

- **WHEN** an install is proposed
- **THEN** the proposed change names every hook and every program it would add

#### Scenario: The blocking hook is removable on its own

- **WHEN** the wait is uninstalled
- **THEN** the non-blocking hooks are left as they were, because a user who wants the mascot without the wait should be able to have it

#### Scenario: Neither is installed by default

- **WHEN** the companion is started
- **THEN** no hook is installed as a side effect of starting
