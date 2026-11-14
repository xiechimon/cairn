FROM public.ecr.aws/lambda/nodejs:24@sha256:eb0de3ee81b4638149f0b1bcab2c657603a23a0c221a4b5678be29b48265bd31
COPY --chmod=0444 code-based-eval-handler.mjs ${LAMBDA_TASK_ROOT}/
CMD ["code-based-eval-handler.handler"]
