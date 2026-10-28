#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/landlock.h>
#include <linux/seccomp.h>
#include <sched.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/ptrace.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

#if !defined(__x86_64__)
#error Unsupported architecture
#endif

static void fatal(const char *message) {
  perror(message);
  exit(125);
}

static void allow_path(int ruleset, const char *path, uint64_t access) {
  int fd = open(path, O_PATH | O_CLOEXEC);
  if (fd < 0) fatal(path);
  struct landlock_path_beneath_attr rule = {.allowed_access = access, .parent_fd = fd};
  if (syscall(SYS_landlock_add_rule, ruleset, LANDLOCK_RULE_PATH_BENEATH, &rule, 0))
    fatal("landlock_add_rule");
  close(fd);
}

static int probe_abi(void) {
#if defined(ROUTING_LANDLOCK_ABI_OVERRIDE)
  return ROUTING_LANDLOCK_ABI_OVERRIDE;
#else
  return syscall(SYS_landlock_create_ruleset, NULL, 0, LANDLOCK_CREATE_RULESET_VERSION);
#endif
}

static void restrict_child(const char *workspace, const char *manifest) {
  int abi = probe_abi();
  if (abi < 3) {
    fprintf(stderr, "Landlock ABI 3 required, kernel provides %d\n", abi);
    exit(125);
  }
  uint64_t all = (1ULL << 15) - 1;
  struct landlock_ruleset_attr attr = {.handled_access_fs = all};
  int ruleset = syscall(SYS_landlock_create_ruleset, &attr, sizeof(attr), 0);
  if (ruleset < 0) fatal("landlock_create_ruleset");
  allow_path(ruleset, workspace, all);
  FILE *files = fopen(manifest, "r");
  if (!files) fatal("runtime manifest");
  char *line = NULL;
  size_t capacity = 0;
  while (getline(&line, &capacity, files) >= 0) {
    line[strcspn(line, "\n")] = 0;
    allow_path(ruleset, line, LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_EXECUTE);
  }
  free(line);
  fclose(files);
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)) fatal("no_new_privs");
  if (syscall(SYS_landlock_restrict_self, ruleset, 0)) fatal("landlock_restrict_self");
  close(ruleset);
  struct sock_filter filter[] = {
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AUDIT_ARCH_X86_64, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
    BPF_JUMP(BPF_JMP | BPF_JGE | BPF_K, 0x40000000, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_clone, 0, 4),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
    BPF_JUMP(BPF_JMP | BPF_JSET | BPF_K, CLONE_UNTRACED, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_clone3, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | ENOSYS),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_ptrace, 8, 0),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_process_vm_readv, 7, 0),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_process_vm_writev, 6, 0),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_io_uring_setup, 5, 0),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_socket, 4, 0),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_open_by_handle_at, 3, 0),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_mount, 2, 0),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_unshare, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
  };
  struct sock_fprog program = {.len = sizeof(filter) / sizeof(filter[0]), .filter = filter};
  if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program)) fatal("seccomp");
}

struct tracee {
  pid_t pid;
  char path[4096];
  long syscall;
  struct tracee *next;
};

static const char *const runtime_data_prefixes[] = {
  "/usr/share/locale/",
  "/usr/share/coreutils/locales/",
};

static int is_runtime_denial(const struct tracee *state) {
  if (state->syscall == SYS_io_uring_setup || state->syscall == SYS_socket) return 1;
  const char *path = state->path;
  if (strcmp(path, "/dev/tty") == 0) return 1;
  if (strcmp(path, "/proc/self/maps") == 0) return 1;
  if (strcmp(path, "/proc/self/cgroup") == 0) return 1;
  if (strcmp(path, "/proc/meminfo") == 0) return 1;
  if (strcmp(path, "/proc/stat") == 0) return 1;
  if (strcmp(path, "/proc/version_signature") == 0) return 1;
  if (strcmp(path, "/proc/mounts") == 0) return 1;
  if (strcmp(path, "/proc/filesystems") == 0) return 1;
  if (strcmp(path, "/sys/devices/system/cpu/online") == 0) return 1;
  for (size_t index = 0; index < sizeof(runtime_data_prefixes) / sizeof(runtime_data_prefixes[0]);
       index++) {
    if (strncmp(path, runtime_data_prefixes[index], strlen(runtime_data_prefixes[index])) == 0)
      return 1;
  }
  return 0;
}

static void read_string(pid_t pid, uint64_t address, char *out, size_t size) {
  size_t offset = 0;
  while (offset + sizeof(long) < size) {
    errno = 0;
    long word = ptrace(PTRACE_PEEKDATA, pid, address + offset, 0);
    if (errno) break;
    memcpy(out + offset, &word, sizeof(word));
    if (memchr(&word, 0, sizeof(word))) return;
    offset += sizeof(word);
  }
  out[offset] = 0;
}

int main(int argc, char **argv) {
  if (argc != 7) return 125;
  FILE *audit = fopen(argv[3], "w");
  if (!audit) fatal("audit");
  int flags = fcntl(fileno(audit), F_GETFD);
  fcntl(fileno(audit), F_SETFD, flags | FD_CLOEXEC);
  pid_t child = fork();
  if (child < 0) fatal("fork");
  if (child == 0) {
    fclose(audit);
    if (chdir(argv[1])) fatal("workspace");
    if (ptrace(PTRACE_TRACEME, 0, 0, 0)) fatal("ptrace");
    raise(SIGSTOP);
    restrict_child(argv[1], argv[2]);
    if (syscall(SYS_close_range, 3, ~0U, 0)) fatal("close_range");
    execl(argv[4], argv[4], "-c", argv[5], (char *)NULL);
    fatal("exec");
  }
  int status;
  if (waitpid(child, &status, 0) != child || !WIFSTOPPED(status)) fatal("initial stop");
  long options = PTRACE_O_TRACESYSGOOD | PTRACE_O_TRACEFORK | PTRACE_O_TRACEVFORK |
    PTRACE_O_TRACECLONE | PTRACE_O_TRACEEXEC | PTRACE_O_EXITKILL;
  if (ptrace(PTRACE_SETOPTIONS, child, 0, options)) fatal("trace options");
  struct tracee *tracees = NULL;
  int exit_code = 125;
  int saw_exec = 0;
  if (ptrace(PTRACE_SYSCALL, child, 0, 0)) fatal("trace start");
  for (;;) {
    pid_t pid = waitpid(-1, &status, __WALL);
    if (pid < 0) {
      if (errno == EINTR) continue;
      if (errno == ECHILD) break;
      fatal("waitpid");
    }
    struct tracee **slot = &tracees;
    while (*slot && (*slot)->pid != pid) slot = &(*slot)->next;
    if (WIFEXITED(status) || WIFSIGNALED(status)) {
      if (pid == child) exit_code = WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
      if (*slot) { struct tracee *old = *slot; *slot = old->next; free(old); }
      continue;
    }
    if (!*slot) {
      *slot = calloc(1, sizeof(struct tracee));
      if (!*slot) fatal("trace state");
      (*slot)->pid = pid;
    }
    struct tracee *state = *slot;
    int signal = WSTOPSIG(status);
    if (signal == (SIGTRAP | 0x80)) {
      struct __ptrace_syscall_info info;
      if (ptrace(PTRACE_GET_SYSCALL_INFO, pid, sizeof(info), &info) < 0) fatal("syscall info");
      if (info.op == PTRACE_SYSCALL_INFO_ENTRY) {
        state->syscall = info.entry.nr;
        state->path[0] = 0;
        uint64_t address = 0;
        if (state->syscall == SYS_open || state->syscall == SYS_execve) address = info.entry.args[0];
        if (state->syscall == SYS_openat || state->syscall == SYS_openat2 || state->syscall == SYS_execveat)
          address = info.entry.args[1];
        if (address) read_string(pid, address, state->path, sizeof(state->path));
      } else if (info.op == PTRACE_SYSCALL_INFO_EXIT && info.exit.is_error &&
                 (info.exit.rval == -EACCES || info.exit.rval == -EPERM)) {
        int runtime_probe = is_runtime_denial(state);
        fprintf(audit, "%s %ld ", runtime_probe ? "RUNTIME_DENIED" : "DENIED", state->syscall);
        for (unsigned char *p = (unsigned char *)state->path; *p; p++) fprintf(audit, "%02x", *p);
        fprintf(audit, "\n");
        fflush(audit);
      }
      signal = 0;
    } else if (signal == SIGTRAP) {
      if (pid == child && (status >> 16) == PTRACE_EVENT_EXEC) saw_exec = 1;
      signal = 0;
    } else if (signal == SIGSTOP) {
      signal = 0;
    }
    if (ptrace(PTRACE_SYSCALL, pid, 0, signal) && errno != ESRCH) fatal("trace resume");
  }
  if (!saw_exec) {
    fprintf(audit, "ENFORCEMENT_UNAVAILABLE\n");
    fclose(audit);
    return 125;
  }
  fprintf(audit, "COMPLETE\n");
  fclose(audit);
  return exit_code;
}
