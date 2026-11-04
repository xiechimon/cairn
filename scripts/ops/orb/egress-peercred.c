#define _GNU_SOURCE
#include <node_api.h>
#include <sys/socket.h>

static napi_value peer_pid(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value arg;
  napi_value result;
  int fd = -1;
  struct ucred cred;
  socklen_t len = sizeof(cred);

  napi_get_cb_info(env, info, &argc, &arg, NULL, NULL);
  napi_get_value_int32(env, arg, &fd);
  if (getsockopt(fd, SOL_SOCKET, SO_PEERCRED, &cred, &len) != 0) {
    napi_get_undefined(env, &result);
    return result;
  }
  napi_create_int32(env, cred.pid, &result);
  return result;
}

NAPI_MODULE_INIT() {
  napi_value fn;
  napi_create_function(env, "peerPid", NAPI_AUTO_LENGTH, peer_pid, NULL, &fn);
  napi_set_named_property(env, exports, "peerPid", fn);
  return exports;
}
